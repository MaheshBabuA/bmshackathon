(function () {
  "use strict";

  const BASE_PATH = "/stitch_crisisgrid_emergency_command_platform";
  const PAGE_PATHS = {
    allocation_confirmed_dispatched:
      BASE_PATH + "/allocation_confirmed_dispatched/code.html",
    authority_review_authorization:
      BASE_PATH + "/authority_review_authorization/code.html",
    city_command_center: BASE_PATH + "/city_command_center/code.html",
    citizen_emergency_home:
      BASE_PATH + "/citizen_emergency_home/code.html",
    emergency_incident_intake:
      BASE_PATH + "/emergency_incident_intake/code.html",
    live_incidents_system_impact:
      BASE_PATH + "/live_incidents_system_impact/code.html",
  };
  const SECTORS = [
    { id: "hospital_network", names: ["Hospital Network", "Hospitals"] },
    {
      id: "water_infrastructure",
      names: ["Water Infrastructure", "Water Works", "Water"],
    },
    {
      id: "telecommunications",
      names: ["Telecommunications", "Telecom Nodes", "Telecom"],
    },
    {
      id: "emergency_operations",
      names: ["Emergency Operations", "Emergency Ops"],
    },
  ];

  let dashboard = null;
  let lastLoadError = "";
  let noticeTimeout = null;
  let busy = false;
  let selectedIncidentId = null;
  let selectedIncidentAnalysis = null;
  let incidentFilter = "all";
  let incidentSearch = "";
  let incidentCardTemplate = null;
  let incidentListContainer = null;
  let currentAuthorityPlan = null;
  let currentRole = "AUTHORITY";
  let currentSignerRole = "Disaster Coordinator";

  const SIGNER_PROFILES = {
    "Disaster Coordinator": {
      name: "Dr. Arvind Rao",
      badge: "EOC-4 Key Holder",
      roleText: "Municipal Disaster Coordinator • Civil Defense Infrastructure Wing",
      tokenText: "Cryptographic Hardware Token Verified (EOC-NET Secure Handshake Active)",
      sessionId: "BLR-EOC-2026-X889",
    },
    "Gov. Operations Lead": {
      name: "S. Mukherjee",
      badge: "Gov. Operations Lead",
      roleText: "Karnataka State Disaster Management Authority • Chief Grid Controller",
      tokenText: "State Executive Digital Key Authenticated (K-SWAN Root CA)",
      sessionId: "BLR-GOV-2026-M441",
    },
  };

  const FALLBACK_LOCATION = {
    location: "Indiranagar, 100ft Rd",
    address: "Plot 42, 12th Main Road, HAL 2nd Stage, Indiranagar, Bengaluru",
    latitude: 12.9716,
    longitude: 77.6412,
    source: "demo_fallback",
  };
  const CATEGORY_COPY = {
    medical: { title: "Medical Emergency", badge: "Trauma / Immediate Care" },
    fire: { title: "Fire Rescue", badge: "Fire & Hazardous" },
    flood: { title: "Disaster", badge: "Evacuation & Flood" },
    infrastructure: { title: "Civic Hazard", badge: "Infrastructure Safety" },
  };
  const SAFETY_FLOORS = {
    hospital_network: 15.5,
    water_infrastructure: 8.0,
    telecommunications: 4.5,
    emergency_operations: 8.0,
  };

  function showNotice(message, isError, persistent) {
    let notice = document.getElementById("crisisgrid-status");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "crisisgrid-status";
      notice.className =
        "fixed bottom-4 right-4 z-[100] max-w-sm rounded-lg border border-outline-variant bg-surface-container-high px-4 py-3 text-body-md text-on-surface shadow-xl";
      notice.setAttribute("role", isError ? "alert" : "status");
      notice.setAttribute("aria-live", isError ? "assertive" : "polite");
      document.body.appendChild(notice);
    }

    notice.setAttribute("role", isError ? "alert" : "status");
    notice.setAttribute("aria-live", isError ? "assertive" : "polite");
    notice.textContent = message;
    if (noticeTimeout !== null) {
      window.clearTimeout(noticeTimeout);
      noticeTimeout = null;
    }
    if (!persistent && !isError) {
      noticeTimeout = window.setTimeout(function () {
        if (notice.textContent === message) notice.remove();
        noticeTimeout = null;
      }, 4500);
    }
  }

  async function request(path, options) {
    let response;
    try {
      response = await fetch(path, options);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The server could not be reached.";
      throw new Error("Could not reach the CRISISGRID simulation server: " + message);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("The simulation server returned an invalid response.");
    }

    if (!response.ok) {
      throw new Error(
        payload && typeof payload.message === "string"
          ? payload.message
          : "The simulation request failed with status " + response.status + ".",
      );
    }
    return payload;
  }

  function textLeaves() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const leaves = [];
    let node;
    while ((node = walker.nextNode())) {
      const value = node.textContent;
      if (value && value.trim()) leaves.push(node);
    }
    return leaves;
  }

  function replaceCount(pattern, replacement) {
    for (const node of textLeaves()) {
      if (pattern.test(node.textContent || "")) {
        node.textContent = (node.textContent || "").replace(
          pattern,
          replacement,
        );
      }
    }
  }

  function normalizeText(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function setIncidentCounts(data) {
    const criticalCount = data.incidents.filter(function (incident) {
      return incident.status === "active" && incident.severity === "critical";
    }).length;

    for (const button of document.querySelectorAll("button")) {
      const label = button.textContent.trim();
      const count = label.startsWith("All Incidents ")
        ? data.incidents.length
        : label.startsWith("Critical ")
          ? criticalCount
          : null;
      if (count === null) continue;

      const badge = Array.from(button.children).find(function (child) {
        return /^\(\d+\)$/.test(child.textContent.trim());
      });
      if (badge) badge.textContent = "(" + count + ")";
      else {
        for (const node of textLeaves()) {
          if (button.contains(node) && /^\s*\(\d+\)\s*$/.test(node.textContent || "")) {
            node.textContent = "(" + count + ")";
          }
        }
      }
    }

    for (const anchor of document.querySelectorAll("a")) {
      if (!/\bIncidents\b/.test(anchor.textContent)) continue;
      const countNode = Array.from(anchor.querySelectorAll("span")).find(
        function (span) {
          return /^\d+$/.test(span.textContent.trim());
        },
      );
      if (countNode) countNode.textContent = String(data.activeIncidentsCount);
    }
  }

  function findExactTextElement(names) {
    const candidates = document.querySelectorAll(
      "h1,h2,h3,h4,span,strong,div,p",
    );
    return Array.from(candidates).find(function (element) {
      return (
        element.childElementCount === 0 &&
        names.some(function (name) {
          return normalizeText(element.textContent) === name;
        })
      );
    });
  }

  function findCard(label) {
    const title = label.id
      ? Array.from(document.querySelectorAll(".font-headline-sm")).find(
          function (element) {
            return (
              element.childElementCount === 0 &&
              label.names.some(function (name) {
                return normalizeText(element.textContent) === name;
              })
            );
          },
        )
      : findExactTextElement(label.names);
    if (!title) return null;
    title.setAttribute("data-crisisgrid-sector-label", label.id);

    let candidate = title.parentElement;
    while (candidate && candidate !== document.body) {
      const isCard = [
        "rounded",
        "rounded-sm",
        "rounded-md",
        "rounded-lg",
        "rounded-xl",
        "rounded-2xl",
        "rounded-3xl",
      ].some(function (className) {
        return candidate.classList.contains(className);
      });
      if (isCard) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function getIncidentScreenSection(columnClass) {
    return Array.from(document.querySelectorAll("main section")).find(
      function (section) {
        return section.classList.contains(columnClass);
      },
    ) || null;
  }

  function getSelectedIncident(data) {
    const requestedId = new URLSearchParams(window.location.search).get("incident");
    const requested = data.incidents.find(function (incident) {
      return incident.id === requestedId;
    });
    const existing = data.incidents.find(function (incident) {
      return incident.id === selectedIncidentId;
    });
    const selected =
      requested ||
      existing ||
      data.incidents.find(function (incident) {
        return incident.status === "active";
      }) ||
      data.incidents[0] ||
      null;
    selectedIncidentId = selected?.id || null;
    return selected;
  }

  function updateIncidentFilterCounts(data) {
    const critical = data.incidents.filter(function (incident) {
      return incident.severity === "critical";
    }).length;
    for (const button of document.querySelectorAll("main button")) {
      const label = normalizeText(button.textContent);
      const count = label.startsWith("All Incidents")
        ? data.incidents.length
        : label.startsWith("Critical")
          ? critical
          : null;
      if (count === null) continue;
      const countNode = Array.from(button.querySelectorAll("span")).find(
        function (span) {
          return /^\(\d+\)$/.test(span.textContent.trim());
        },
      );
      if (countNode) countNode.textContent = "(" + count + ")";
    }
  }

  function formatElapsed(createdAt) {
    const minutes = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(createdAt)) / 60_000),
    );
    if (minutes < 1) return "just now";
    if (minutes < 60) return minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function humanizeIncidentType(value) {
    return value
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function incidentMatchesFilter(incident) {
    if (incidentFilter === "critical" && incident.severity !== "critical") {
      return false;
    }
    if (incidentFilter === "escalated" && !incident.isEscalated) return false;
    if (incidentFilter === "triage" && !incident.automatedTriage) return false;
    if (!incidentSearch) return true;
    const haystack = [
      incident.incidentCode,
      incident.title,
      incident.address,
      incident.location,
      incident.incidentType,
    ].join(" ").toLowerCase();
    return haystack.includes(incidentSearch.toLowerCase());
  }

  function setIncidentCardText(article, incident) {
    const code = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return /^INC-[\w-]+$/i.test(span.textContent.trim());
      },
    );
    if (code) code.textContent = incident.incidentCode;

    const title = article.querySelector("h2");
    if (title) title.textContent = incident.title;

    const time = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return /\d+\s*[mhd]\s*ago|just now/i.test(span.textContent.trim());
      },
    );
    if (time) time.textContent = formatElapsed(incident.createdAt);

    const pin = Array.from(article.querySelectorAll(".material-symbols-outlined")).find(
      function (span) {
        return span.textContent.trim() === "pin_drop";
      },
    );
    const location = pin?.parentElement
      ? Array.from(pin.parentElement.querySelectorAll("span")).find(
          function (span) {
            return span !== pin && !span.classList.contains("material-symbols-outlined");
          },
        )
      : null;
    if (location) location.textContent = incident.address || incident.location;

    const badge = article.querySelector("span.rounded-full");
    if (badge) {
      badge.textContent = incident.severity.toUpperCase();
      badge.classList.remove(
        "bg-error-container/30",
        "text-error",
        "bg-secondary-container/40",
        "text-secondary-fixed",
        "bg-tertiary/10",
        "text-tertiary",
      );
      if (incident.severity === "critical") {
        badge.classList.add("bg-error-container/30", "text-error");
      } else if (incident.severity === "urgent") {
        badge.classList.add("bg-secondary-container/40", "text-secondary-fixed");
      } else {
        badge.classList.add("bg-tertiary/10", "text-tertiary");
      }
    }

    const demandSummary = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return /Demand Spike:/.test(span.textContent);
      },
    );
    if (demandSummary) {
      demandSummary.textContent =
        "Demand Impact: " + incident.impacts.length + " infrastructure sectors";
    }
    const impactRows = Array.from(article.querySelectorAll("div")).filter(
      function (element) {
        return element.classList.contains("flex") &&
          element.classList.contains("items-center") &&
          element.classList.contains("justify-between") &&
          element.querySelectorAll("span").length === 2;
      },
    );
    impactRows.slice(0, 3).forEach(function (row, index) {
      const impact = incident.impacts[index];
      const spans = row.querySelectorAll("span");
      if (!impact || spans.length < 2) {
        row.hidden = true;
        return;
      }
      row.hidden = false;
      spans[0].textContent = impact.sectorId.replace(/_/g, " ");
      spans[1].textContent =
        (impact.demandDeltaMw > 0 ? "+" : "") +
        impact.demandDeltaMw.toFixed(1) +
        " MW";
    });
  }

  function renderIncidentList(data) {
    const section = getIncidentScreenSection("lg:col-span-5");
    if (!section) return;
    const firstArticle = section.querySelector("article");
    if (!incidentListContainer) {
      incidentListContainer = firstArticle?.parentElement ||
        section.querySelector("div.flex.flex-col.gap-3");
    }
    if (!incidentListContainer) return;
    if (!incidentCardTemplate && firstArticle) {
      incidentCardTemplate = firstArticle.cloneNode(true);
    }
    if (!incidentCardTemplate) return;

    const visible = data.incidents.filter(incidentMatchesFilter);
    incidentListContainer.querySelectorAll(":scope > article").forEach(function (article) {
      article.remove();
    });
    incidentListContainer.querySelectorAll(":scope > p[data-crisisgrid-empty]").forEach(
      (empty) => empty.remove(),
    );
    for (const incident of visible) {
      const article = incidentCardTemplate.cloneNode(true);
      article.dataset.crisisgridIncident = incident.id;
      article.tabIndex = 0;
      article.setAttribute("role", "button");
      article.setAttribute("aria-selected", String(incident.id === selectedIncidentId));
      article.classList.toggle("bg-surface-container-high", incident.id === selectedIncidentId);
      article.classList.toggle("bg-surface-container-low", incident.id !== selectedIncidentId);
      article.classList.toggle("shadow-lg", incident.id === selectedIncidentId);
      article.classList.toggle("shadow-sm", incident.id !== selectedIncidentId);
      setIncidentCardText(article, incident);
      incidentListContainer.appendChild(article);
    }

    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "p-space-md text-body-sm text-on-surface-variant";
      empty.dataset.crisisgridEmpty = "true";
      empty.textContent = "No incidents match the selected filter.";
      incidentListContainer.appendChild(empty);
    }
  }

  function renderIncidentDetails(data) {
    const incident = getSelectedIncident(data);
    if (!incident) return;
    const section = getIncidentScreenSection("lg:col-span-7");
    const article = section?.querySelector(":scope > article");
    if (!article) return;
    article.dataset.crisisgridIncident = incident.id;

    const code = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return /^INC-[\w-]+$/i.test(span.textContent.trim());
      },
    );
    if (code) code.textContent = incident.incidentCode;
    const dispatchType = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return span.textContent.includes("Municipal Dispatch");
      },
    );
    if (dispatchType) {
      dispatchType.textContent = humanizeIncidentType(incident.incidentType) + " Dispatch";
    }
    const stateLabel = Array.from(article.querySelectorAll("span")).find(
      function (span) {
        return /VECTOR ACTIVE|VECTOR ESCALATED/i.test(span.textContent);
      },
    );
    if (stateLabel) {
      stateLabel.textContent =
        incident.severity.toUpperCase() +
        (incident.isEscalated ? " VECTOR ESCALATED" : " VECTOR ACTIVE");
    }
    const heading = article.querySelector("h2");
    if (heading) {
      heading.textContent =
        incident.title + " — " + (incident.address || incident.location);
    }

    const setDetailValue = function (labelText, value) {
      const label = Array.from(article.querySelectorAll("span")).find(
        function (span) {
          return span.textContent.trim() === labelText;
        },
      );
      const container = label?.parentElement?.parentElement;
      const valueNode = container?.querySelector(".font-body-md");
      if (valueNode) valueNode.textContent = value;
    };
    setDetailValue(
      "Active Dispatch Units",
      incident.dispatchDetails || incident.responseUnits + " units assigned",
    );
    setDetailValue(
      "Evacuation & Perimeter",
      incident.evacuationRadiusM > 0
        ? "Radius: " +
            incident.evacuationRadiusM.toLocaleString("en-US") +
            "m · " +
            incident.residentsAlerted.toLocaleString("en-US") +
            " Residents Alerted"
        : incident.perimeterDetails,
    );
    renderCrossInfrastructureImpact(section, incident);
  }

  function sectorForImpactName(name) {
    const normalized = normalizeText(name).toLowerCase();
    if (/hospital/.test(normalized)) return "hospital_network";
    if (/water/.test(normalized)) return "water_infrastructure";
    if (/telecommunications|telecom/.test(normalized)) return "telecommunications";
    if (/emergency|operations/.test(normalized)) return "emergency_operations";
    return null;
  }

  function renderCrossInfrastructureImpact(section, incident) {
    const analysis = selectedIncidentAnalysis?.incident?.id === incident.id
      ? selectedIncidentAnalysis
      : null;
    const impacts = analysis?.impacts || incident.impacts.map(function (impact) {
      return {
        sectorId: impact.sectorId,
        sectorName: impact.sectorId.replace(/_/g, " "),
        demandDeltaMw: impact.demandDeltaMw,
        reason: impact.reason || impact.rationale,
      };
    });
    const impactMap = new Map(impacts.map((impact) => [impact.sectorId, impact]));
    const cards = Array.from(section.querySelectorAll("div.p-space-md")).filter(
      function (card) {
        return card.querySelector(".font-headline-sm");
      },
    );
    for (const card of cards) {
      const heading = card.querySelector(".font-headline-sm");
      const sectorId = heading ? sectorForImpactName(heading.textContent) : null;
      if (!sectorId) continue;
      const impact = impactMap.get(sectorId);
      const badge = card.querySelector("span.rounded-full");
      const rationale = card.querySelector("p");
      const meter = card.querySelector('[style*="width"]');
      if (!impact) {
        if (badge) badge.textContent = "No Direct Impact";
        if (rationale) rationale.textContent = "No incident impact is recorded for this infrastructure sector.";
        if (meter) meter.style.width = "0%";
        continue;
      }
      if (badge) {
        const delta = impact.demandDeltaMw;
        badge.textContent = delta > 0
          ? "Demand Surge (+" + delta.toFixed(1) + " MW)"
          : delta < 0
            ? "Demand Reduction (" + delta.toFixed(1) + " MW)"
            : "Priority Services Protected";
      }
      if (rationale) {
        rationale.textContent =
          impact.reason || "Incident demand impact recorded in the database.";
      }
      if (meter) {
        const sector = dashboard?.sectors.find((item) => item.id === sectorId);
        const percent = sector && sector.baselineDemandMw > 0
          ? Math.min(100, Math.round(Math.abs(impact.demandDeltaMw) / sector.baselineDemandMw * 100))
          : 0;
        meter.style.width = percent + "%";
      }
    }
    const affectedLabel = Array.from(section.querySelectorAll("span")).find(
      function (span) {
        return /^\d+\s+DOMAINS AFFECTED$/i.test(span.textContent.trim());
      },
    );
    if (affectedLabel) {
      affectedLabel.textContent = impacts.length + " DOMAINS AFFECTED";
    }
  }

  function renderDynamicAllocationModel(analysis) {
    if (!analysis?.simulation || !analysis.incident) return;
    const section = getIncidentScreenSection("lg:col-span-7");
    const heading = Array.from(section?.querySelectorAll("h3") || []).find(
      function (element) {
        return element.textContent.trim() === "Dynamic Reallocation Model";
      },
    );
    let model = heading;
    while (
      model &&
      !(model.classList.contains("p-space-lg") &&
        model.classList.contains("rounded-xl"))
    ) {
      model = model.parentElement;
    }
    if (!model) return;
    const rowContainer = Array.from(model.children).find(
      function (child) {
        return child.classList.contains("flex") &&
          child.classList.contains("flex-col") &&
          child.classList.contains("gap-3");
      },
    );
    if (!rowContainer) return;

    for (const result of analysis.simulation.sectors) {
      const label = SECTORS.find((sector) => sector.id === result.sectorId);
      if (!label) continue;
      const row = Array.from(rowContainer.querySelectorAll(":scope > div")).find(
        function (candidate) {
          const name = candidate.querySelector(".font-body-md.font-medium");
          return name && label.names.some(
            (alias) => normalizeText(name.textContent) === alias,
          );
        },
      );
      if (!row) continue;
      const allocation = row.querySelector(".font-mono.text-body-md.text-outline");
      const recommendation = row.querySelector(".text-on-surface.font-semibold");
      const delta = row.querySelector("span.px-2");
      const state = row.querySelector(".font-mono.text-\\[11px\\].uppercase");
      const rationale = row.querySelector("p");
      if (allocation) {
        allocation.firstChild.textContent =
          result.previousAllocation.toFixed(1) + " MW ";
      }
      if (recommendation) {
        recommendation.textContent =
          result.recommendedAllocation.toFixed(1) + " MW";
      }
      if (delta) {
        delta.textContent =
          "Δ " + (result.delta > 0 ? "+" : "") + result.delta.toFixed(1) + " MW";
      }
      if (state) state.textContent = result.status.replace(/_/g, " ").toUpperCase();
      if (rationale) rationale.textContent = result.rationale;
    }

    const summary = analysis.simulation.warnings.length > 0
      ? analysis.simulation.warnings.join(" ")
      : "Total " +
        analysis.simulation.totalAllocated.toFixed(1) +
        " / " +
        analysis.simulation.totalAvailableCapacity.toFixed(1) +
        " MW · " +
        analysis.simulation.status.replace(/_/g, " ");
    const status = model.querySelector(".p-3.rounded-lg.bg-surface-container-high");
    if (status) {
      const text = status.querySelector(".text-on-surface-variant");
      if (text) text.textContent = summary;
      else status.setAttribute("aria-label", summary);
    }
  }

  function updateModifierModalCalculations() {
    const rangeHospital = document.getElementById("range-hospital");
    const rangeWater = document.getElementById("range-water");
    const rangeTelecom = document.getElementById("range-telecom");
    const rangeOps = document.getElementById("range-emergency-ops");
    const rangeDelta = document.getElementById("mod-demand-delta");

    const hospital = parseFloat(rangeHospital?.value || "17.0");
    const water = parseFloat(rangeWater?.value || "12.0");
    const telecom = parseFloat(rangeTelecom?.value || "5.0");
    const ops = parseFloat(rangeOps?.value || "11.0");
    const delta = parseFloat(rangeDelta?.value || "0.0");

    const valHospital = document.getElementById("val-hospital");
    const valWater = document.getElementById("val-water");
    const valTelecom = document.getElementById("val-telecom");
    const valOps = document.getElementById("val-emergency-ops");
    const valDelta = document.getElementById("val-demand-delta");

    if (valHospital) valHospital.textContent = hospital.toFixed(1) + " MW";
    if (valWater) valWater.textContent = water.toFixed(1) + " MW";
    if (valTelecom) valTelecom.textContent = telecom.toFixed(1) + " MW";
    if (valOps) valOps.textContent = ops.toFixed(1) + " MW";
    if (valDelta)
      valDelta.textContent = (delta >= 0 ? "+" : "") + delta.toFixed(1) + " MW";

    const total = hospital + water + telecom + ops;
    const balance = 45.0 - total;

    const valTotal = document.getElementById("val-total-allocated");
    const barTotal = document.getElementById("bar-total-allocated");
    const valBalance = document.getElementById("val-total-balance");
    const statusLabel = document.getElementById("mod-status-label");
    const warningBox = document.getElementById("mod-warning-box");

    if (valTotal) valTotal.textContent = total.toFixed(1) + " / 45.0 MW";
    if (valBalance)
      valBalance.textContent = "Spare Headroom: " + balance.toFixed(1) + " MW";

    const pct = Math.min(100, Math.max(0, (total / 45.0) * 100));
    if (barTotal) {
      barTotal.style.width = pct + "%";
      if (total > 45.001) {
        barTotal.className = "h-full bg-error rounded-full transition-all duration-300";
      } else {
        barTotal.className = "h-full bg-primary rounded-full transition-all duration-300";
      }
    }

    let warning = "";
    if (total > 45.001) {
      warning =
        "CRITICAL: Total requested capacity (" +
        total.toFixed(1) +
        " MW) exceeds 45.0 MW emergency pool ceiling!";
    } else if (hospital < 15.5) {
      warning =
        "Hospital Network (" +
        hospital.toFixed(1) +
        " MW) is below critical safety floor (15.5 MW)!";
    } else if (water < 8.0) {
      warning =
        "Water Infrastructure (" +
        water.toFixed(1) +
        " MW) is below critical safety floor (8.0 MW)!";
    } else if (telecom < 4.5) {
      warning =
        "Telecommunications (" +
        telecom.toFixed(1) +
        " MW) is below critical broadcast floor (4.5 MW)!";
    } else if (ops < 8.0) {
      warning =
        "Emergency Operations (" +
        ops.toFixed(1) +
        " MW) is below critical safety floor (8.0 MW)!";
    }

    if (warningBox) {
      if (warning) {
        warningBox.textContent = warning;
        warningBox.classList.remove("hidden");
        if (statusLabel) {
          statusLabel.textContent = "SAFETY THRESHOLD VIOLATION";
          statusLabel.className = "font-semibold text-error font-mono";
        }
      } else {
        warningBox.textContent = "";
        warningBox.classList.add("hidden");
        if (statusLabel) {
          statusLabel.textContent = "Within Available Capacity (45 MW Max)";
          statusLabel.className = "font-semibold text-tertiary font-mono";
        }
      }
    }
  }

  function renderAuthorityReviewScreen(data) {
    const plan = currentAuthorityPlan || data.recommendedPlan || data.activePlan;
    if (!plan) return;
    currentAuthorityPlan = plan;

    // 1. Status Pill
    const statusPill = document.getElementById("plan-status-pill");
    const statusDot = document.getElementById("plan-status-dot");
    const statusText = document.getElementById("plan-status-text");
    if (statusText) {
      if (plan.status === "approved" || plan.quorum?.isComplete) {
        statusText.textContent = "Plan Authorized & Dispatched";
        statusText.className =
          "font-label-sm text-label-sm uppercase tracking-wider text-tertiary font-medium";
        if (statusDot) {
          statusDot.className = "w-2 h-2 rounded-full bg-tertiary";
        }
        if (statusPill) {
          statusPill.className =
            "flex items-center gap-1.5 px-3 py-1 rounded-full bg-tertiary/10";
        }
      } else if (plan.status === "rejected") {
        statusText.textContent = "Rejected (Baseline Maintained)";
        statusText.className =
          "font-label-sm text-label-sm uppercase tracking-wider text-outline font-medium";
        if (statusDot) {
          statusDot.className = "w-2 h-2 rounded-full bg-outline";
        }
        if (statusPill) {
          statusPill.className =
            "flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high";
        }
      } else {
        statusText.textContent = "Pending Executive Clearance";
        statusText.className =
          "font-label-sm text-label-sm uppercase tracking-wider text-error font-medium";
        if (statusDot) {
          statusDot.className = "w-2 h-2 rounded-full bg-error animate-pulse";
        }
        if (statusPill) {
          statusPill.className =
            "flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-container-high";
        }
      }
    }

    // 2. Quorum Badge
    const quorumText = document.getElementById("plan-quorum-text");
    const quorumIcon = document.getElementById("plan-quorum-icon");
    const quorumCount = document.getElementById("quorum-summary-count");
    const quorumLabel =
      plan.quorum?.label ||
      (plan.signatures?.length
        ? plan.signatures.length + " of 2 Signed"
        : "1 of 2 Signed");
    if (quorumText) quorumText.textContent = quorumLabel;
    if (quorumCount) quorumCount.textContent = quorumLabel.toUpperCase();
    if (quorumIcon) {
      quorumIcon.textContent = plan.quorum?.isComplete
        ? "verified"
        : "verified_user";
      quorumIcon.className =
        "material-symbols-outlined text-[14px] " +
        (plan.quorum?.isComplete ? "text-tertiary" : "text-tertiary");
    }

    // 3. Telemetry Strip
    const emCap = document.getElementById("telemetry-emergency-capacity");
    if (emCap)
      emCap.textContent = String(
        Math.round(plan.availableEmergencyCapacityMw || 45),
      );

    const resEnv = document.getElementById("telemetry-reserve-envelope");
    if (resEnv && data.cityGridLoadMw) {
      resEnv.textContent =
        data.cityGridLoadMw.toFixed(1) +
        " / " +
        data.cityGridCapacityMw.toFixed(1) +
        " MW";
    }

    const reallocDelta = document.getElementById("telemetry-reallocation-delta");
    if (reallocDelta) {
      const delta =
        (plan.totalCapacityMw || 45) -
        (data.activePlan?.totalCapacityMw ?? 45);
      reallocDelta.textContent =
        delta.toFixed(1) +
        " MW (" +
        (Math.abs(delta) < 0.05 ? "Equilibrium" : "Shift") +
        ")";
    }

    const loadFactor = document.getElementById("telemetry-load-factor");
    const loadBar = document.getElementById("telemetry-load-factor-bar");
    const loadPct = plan.activeCrisisLoadFactorPercent || 78;
    if (loadFactor) loadFactor.textContent = String(loadPct);
    if (loadBar) loadBar.style.width = loadPct + "%";

    const baseLoad = document.getElementById("telemetry-base-load");
    if (baseLoad && data.sectors) {
      const sum = data.sectors.reduce(function (acc, s) {
        return acc + s.demandMw;
      }, 0);
      baseLoad.textContent = "Base Load: " + sum.toFixed(1) + " MW";
    }

    const affectedCount = document.getElementById("telemetry-affected-count");
    if (affectedCount)
      affectedCount.textContent = String(plan.affectedSectorsCount || 4);

    const affectedList = document.getElementById("telemetry-affected-list");
    if (affectedList && Array.isArray(plan.affectedSectorsList)) {
      affectedList.innerHTML = plan.affectedSectorsList
        .map(function (s) {
          return (
            '<span class="px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">' +
            s +
            "</span>"
          );
        })
        .join("");
    }

    const stabMin = document.getElementById("telemetry-stabilization-minutes");
    if (stabMin)
      stabMin.textContent = String(plan.stabilizationWindowMinutes || 18);

    const stabEta = document.getElementById("telemetry-stabilization-eta");
    if (stabEta && plan.stabilizationEta)
      stabEta.textContent = plan.stabilizationEta;

    // 4. Sector Allocation Cards
    const sectorGrid = document.getElementById("sector-cards-grid");
    if (sectorGrid && plan.detailedItems) {
      for (const sectorKey of Object.keys(plan.detailedItems)) {
        const item = plan.detailedItems[sectorKey];
        const card = sectorGrid.querySelector(
          '[data-sector-id="' + sectorKey + '"]',
        );
        if (!card) continue;

        const prevNode = card.querySelector(".sector-prev-mw");
        if (prevNode)
          prevNode.textContent = item.previousAllocationMw.toFixed(1);

        const recNode = card.querySelector(".sector-rec-mw");
        if (recNode)
          recNode.textContent = item.recommendedAllocationMw.toFixed(1);

        const deltaNode = card.querySelector(".sector-delta-mw");
        if (deltaNode)
          deltaNode.textContent = Math.abs(item.deltaMw).toFixed(1) + " MW";

        const deltaIcon = card.querySelector(".sector-delta-icon");
        if (deltaIcon)
          deltaIcon.textContent = item.deltaMw >= 0 ? "add" : "remove";

        const deltaBadge = card.querySelector(".sector-delta-badge");
        if (deltaBadge) {
          if (item.statusTone === "critical") {
            deltaBadge.className =
              "sector-delta-badge flex items-center gap-1 px-2 py-0.5 rounded bg-error-container/30 font-mono font-label-sm text-label-sm text-error";
          } else if (item.statusTone === "secondary") {
            deltaBadge.className =
              "sector-delta-badge flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-highest font-mono font-label-sm text-label-sm text-secondary";
          } else {
            deltaBadge.className =
              "sector-delta-badge flex items-center gap-1 px-2 py-0.5 rounded bg-primary/20 font-mono font-label-sm text-label-sm text-primary";
          }
        }

        const rationaleNode = card.querySelector(".sector-rationale");
        if (rationaleNode) rationaleNode.textContent = item.rationale;

        const floorNode = card.querySelector(".sector-floor-val");
        if (floorNode)
          floorNode.textContent = item.safeOperatingFloorMw.toFixed(1) + " MW";

        const marginNode = card.querySelector(".sector-margin-val");
        if (marginNode) {
          marginNode.textContent =
            (item.safetyMarginMw >= 0 ? "+" : "") +
            item.safetyMarginMw.toFixed(1) +
            " MW Safety Margin";
        }

        const statusTextNode = card.querySelector(".sector-status-text");
        if (statusTextNode) statusTextNode.textContent = item.statusLabel;

        const progressBar = card.querySelector(".sector-progress-bar");
        if (progressBar) {
          progressBar.style.width = item.progressPercent + "%";
          if (item.statusTone === "critical") {
            progressBar.className =
              "sector-progress-bar h-full bg-error rounded-full transition-all duration-500";
          } else if (item.statusTone === "secondary") {
            progressBar.className =
              "sector-progress-bar h-full bg-secondary rounded-full transition-all duration-500";
          } else {
            progressBar.className =
              "sector-progress-bar h-full bg-primary rounded-full transition-all duration-500";
          }
        }
      }
    }

    // 5. Decision Factors & Algorithmic Rationale
    const modelRationale = document.getElementById(
      "overall-algorithmic-rationale",
    );
    if (modelRationale) {
      modelRationale.textContent =
        plan.algorithmicRationale ||
        plan.rationale ||
        "Resilience model simulated.";
    }

    const decisionList = document.getElementById("decision-factors-list");
    if (
      decisionList &&
      Array.isArray(plan.decisionFactors) &&
      plan.decisionFactors.length > 0
    ) {
      decisionList.innerHTML = plan.decisionFactors
        .map(function (f) {
          let toneClass = "text-primary";
          if (f.badgeTone === "error") toneClass = "text-error";
          else if (f.badgeTone === "tertiary") toneClass = "text-tertiary";
          else if (f.badgeTone === "secondary") toneClass = "text-secondary";

          return (
            '<div class="p-space-md rounded-lg bg-surface-container flex items-start gap-3">' +
            '<div class="w-6 h-6 rounded-full bg-surface-container-high flex items-center justify-center text-primary font-mono font-label-sm text-label-sm mt-0.5">' +
            f.id +
            "</div>" +
            '<div class="flex-1 flex flex-col">' +
            '<div class="font-label-md text-label-md font-semibold text-on-surface">' +
            f.title +
            "</div>" +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
            f.description +
            "</p>" +
            "</div>" +
            '<span class="font-label-sm text-label-sm ' +
            toneClass +
            ' uppercase font-medium">' +
            f.status +
            "</span>" +
            "</div>"
          );
        })
        .join("");
    }

    // 6. Statutory Compliance
    if (plan.statutoryCompliance) {
      const compSummary = document.getElementById("compliance-summary");
      if (compSummary) {
        compSummary.innerHTML =
          'Fully compliant with <strong class="text-on-surface">' +
          plan.statutoryCompliance.code +
          '</strong> &amp; <strong class="text-on-surface">' +
          plan.statutoryCompliance.directive +
          "</strong>.";
      }
      const compCiv = document.getElementById("compliance-civilian-impact");
      if (compCiv)
        compCiv.textContent =
          plan.statutoryCompliance.civilianImpactClassification;
      const compOver = document.getElementById("compliance-override-threshold");
      if (compOver)
        compOver.textContent = plan.statutoryCompliance.overrideThreshold;
      const compSunset = document.getElementById("compliance-sunset");
      if (compSunset) {
        compSunset.textContent =
          String(plan.statutoryCompliance.automaticSunsetHours).padStart(
            2,
            "0",
          ) + ":00:00 Max";
      }
    }

    // 7. Dual-Key Validation Signer Cards
    const signatures = Array.isArray(plan.signatures) ? plan.signatures : [];
    const govSig = signatures.find(function (s) {
      return s.signerRole === "Gov. Operations Lead";
    });
    const govIcon = document.getElementById("signer-gov-icon");
    const govMeta = document.getElementById("signer-gov-meta");
    const govBadge = document.getElementById("signer-gov-badge");
    if (govSig) {
      if (govIcon) {
        govIcon.textContent = "check_circle";
        govIcon.className =
          "material-symbols-outlined text-[16px] text-tertiary";
      }
      if (govMeta) {
        const hash = govSig.signatureHash || "0x9F4C...B2";
        govMeta.textContent =
          govSig.signerName +
          " (SIG: " +
          hash.slice(0, 8) +
          "..." +
          hash.slice(-4) +
          ")";
      }
      if (govBadge) {
        govBadge.textContent = "SIGNED";
        govBadge.className =
          "px-2 py-0.5 rounded bg-tertiary-container/30 text-tertiary-fixed font-label-sm text-label-sm font-semibold";
      }
    } else {
      if (govIcon) {
        govIcon.textContent = "pending";
        govIcon.className = "material-symbols-outlined text-[16px] text-error";
      }
      if (govMeta) govMeta.textContent = "S. Mukherjee (Awaiting Signature)";
      if (govBadge) {
        govBadge.textContent = "AWAITING";
        govBadge.className =
          "px-2 py-0.5 rounded bg-error-container/30 text-error font-label-sm text-label-sm font-semibold animate-pulse";
      }
    }

    const disasterSig = signatures.find(function (s) {
      return s.signerRole === "Disaster Coordinator";
    });
    const disasterIcon = document.getElementById("signer-disaster-icon");
    const disasterMeta = document.getElementById("signer-disaster-meta");
    const disasterBadge = document.getElementById("signer-disaster-badge");
    if (disasterSig) {
      if (disasterIcon) {
        disasterIcon.textContent = "check_circle";
        disasterIcon.className =
          "material-symbols-outlined text-[16px] text-tertiary";
      }
      if (disasterMeta) {
        const hash = disasterSig.signatureHash || "0xCA12...88";
        disasterMeta.textContent =
          disasterSig.signerName +
          " (SIG: " +
          hash.slice(0, 8) +
          "..." +
          hash.slice(-4) +
          ")";
      }
      if (disasterBadge) {
        disasterBadge.textContent = "SIGNED";
        disasterBadge.className =
          "px-2 py-0.5 rounded bg-tertiary-container/30 text-tertiary-fixed font-label-sm text-label-sm font-semibold";
      }
    } else {
      if (disasterIcon) {
        disasterIcon.textContent = "pending";
        disasterIcon.className =
          "material-symbols-outlined text-[16px] text-error";
      }
      if (disasterMeta)
        disasterMeta.textContent = "Dr. Arvind Rao (Pending Key)";
      if (disasterBadge) {
        disasterBadge.textContent = "AWAITING";
        disasterBadge.className =
          "px-2 py-0.5 rounded bg-error-container/30 text-error font-label-sm text-label-sm font-semibold animate-pulse";
      }
    }

    // 8. Signer Identity Profile & RBAC Toolbar
    const roleSelect = document.getElementById("demo-role-select");
    if (roleSelect && roleSelect.value !== currentRole) {
      roleSelect.value = currentRole;
    }
    const roleBadge = document.getElementById("demo-role-badge");
    if (roleBadge) {
      if (currentRole === "AUTHORITY") {
        roleBadge.textContent = "AUTHORIZED";
        roleBadge.className =
          "px-2 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-tertiary-container/30 text-tertiary-fixed";
      } else if (currentRole === "OPERATOR") {
        roleBadge.textContent = "READ & MODIFY ONLY";
        roleBadge.className =
          "px-2 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-secondary-container text-on-secondary-container";
      } else {
        roleBadge.textContent = "PUBLIC READ-ONLY";
        roleBadge.className =
          "px-2 py-0.5 rounded font-label-sm text-label-sm uppercase font-semibold bg-error-container/30 text-error";
      }
    }

    const signerSelect = document.getElementById("demo-signer-select");
    if (signerSelect && signerSelect.value !== currentSignerRole) {
      signerSelect.value = currentSignerRole;
    }

    const profile =
      SIGNER_PROFILES[currentSignerRole] ||
      SIGNER_PROFILES["Disaster Coordinator"];
    const activeName = document.getElementById("active-signer-name");
    if (activeName) activeName.textContent = profile.name;
    const activeBadge = document.getElementById("active-signer-badge");
    if (activeBadge) activeBadge.textContent = profile.badge;
    const activeRole = document.getElementById("active-signer-role");
    if (activeRole) activeRole.textContent = profile.roleText;
    const activeToken = document.getElementById("active-signer-token");
    if (activeToken) {
      activeToken.innerHTML =
        '<span class="material-symbols-outlined text-[14px]">lock_reset</span><span>' +
        profile.tokenText +
        "</span>";
    }
    const activeSession = document.getElementById("active-session-id");
    if (activeSession) activeSession.textContent = profile.sessionId;

    // 9. Authorize Button State
    const authBtn = document.getElementById("authorize-btn");
    if (authBtn) {
      if (plan.status === "approved" || plan.quorum?.isComplete) {
        authBtn.disabled = true;
        authBtn.className =
          "w-full sm:w-auto px-space-xl py-3 rounded-xl bg-tertiary-container text-on-tertiary-container font-headline-sm text-headline-sm font-semibold tracking-tight shadow-lg flex items-center justify-center gap-2 cursor-default";
        authBtn.innerHTML =
          '<span class="material-symbols-outlined text-[20px]">check_circle</span> Plan Authorized &amp; Dispatched';
      } else {
        authBtn.disabled = false;
        authBtn.className =
          "w-full sm:w-auto px-space-xl py-3 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm font-semibold tracking-tight transition-all duration-200 shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95";
        authBtn.innerHTML =
          '<span class="material-symbols-outlined text-[20px]">verified</span> Authorize &amp; Dispatch Capacity Plan →';
      }
    }

    // 10. Modifier Modal Range inputs sync
    if (plan.items) {
      const rHosp = document.getElementById("range-hospital");
      if (rHosp && !rHosp.dataset.userModified) {
        rHosp.value = String(plan.items.hospital_network ?? 17.0);
      }
      const rWater = document.getElementById("range-water");
      if (rWater && !rWater.dataset.userModified) {
        rWater.value = String(plan.items.water_infrastructure ?? 12.0);
      }
      const rTel = document.getElementById("range-telecom");
      if (rTel && !rTel.dataset.userModified) {
        rTel.value = String(plan.items.telecommunications ?? 5.0);
      }
      const rOps = document.getElementById("range-emergency-ops");
      if (rOps && !rOps.dataset.userModified) {
        rOps.value = String(plan.items.emergency_operations ?? 11.0);
      }
      updateModifierModalCalculations();
    }
  }

  function updateSectorCards(data) {
    const page = window.location.pathname;
    if (page.includes("allocation_confirmed_dispatched")) {
      for (const label of SECTORS) {
        const sector = data.sectors.find(function (item) {
          return item.id === label.id;
        });
        if (!sector || sector.allocatedCapacityMw === null) continue;

        const card = findCard(label);
        if (!card) continue;
        card.setAttribute("data-crisisgrid-sector", sector.id);
        const value = textLeaves().find(function (node) {
          return (
            card.contains(node) &&
            /^\s*\d+(?:\.\d+)?\s*MW\s*$/.test(node.textContent || "")
          );
        });
        if (value) {
          value.textContent = Number(sector.allocatedCapacityMw).toFixed(1) + " MW";
        }
      }
    }

    if (page.includes("city_command_center")) {
      const availableCard = findCard(
        { names: ["Available Emergency Capacity"] },
      );
      if (availableCard) {
        const capacityValue = Array.from(availableCard.querySelectorAll("span")).find(
          function (span) {
            return /^\d+(?:\.\d+)?$/.test(span.textContent.trim()) &&
              span.className.includes("font-display");
          },
        );
        if (capacityValue) {
          capacityValue.textContent = String(data.availableCapacityMw);
        }
        const reserveLabel = Array.from(
          availableCard.querySelectorAll("span"),
        ).find(function (span) {
          return span.textContent.includes("Reserve Grid Load");
        });
        if (reserveLabel) {
          reserveLabel.textContent =
            "Metropolitan Grid Load (" +
            data.cityGridLoadMw.toFixed(1) +
            " / " +
            data.cityGridCapacityMw.toFixed(1) +
            " MW)";
        }
        const reserved = Array.from(
          availableCard.querySelectorAll("span"),
        ).find(function (span) {
          return /\d+%\s*Utilized/.test(span.textContent);
        });
        const activeTotal =
          data.activePlan?.totalCapacityMw ?? 0;
        if (reserved) {
          reserved.textContent =
            Math.round((activeTotal / data.availableCapacityMw) * 100) +
            "% Allocated";
        }
        const meter = availableCard.querySelector('[style*="width"]');
        if (meter) {
          meter.style.width =
            Math.min(100, (activeTotal / data.availableCapacityMw) * 100) + "%";
        }
      }

      const activeCard = findCard(
        { names: ["Active Incidents"] },
      );
      if (activeCard) {
        const clusterCount = Array.from(
          activeCard.querySelectorAll("span"),
        ).find(function (span) {
          return /^\d{1,2}$/.test(span.textContent.trim()) &&
            span.className.includes("font-display");
        });
        if (clusterCount) {
          clusterCount.textContent = String(data.activeIncidentsCount).padStart(
            2,
            "0",
          );
        }
        const criticalBadge = Array.from(
          activeCard.querySelectorAll("span"),
        ).find(function (span) {
          return /^\d+\s+CRITICAL$/.test(span.textContent.trim());
        });
        if (criticalBadge) {
          const criticalCount = data.incidents.filter(function (incident) {
            return incident.status === "active" && incident.severity === "critical";
          }).length;
          criticalBadge.textContent = criticalCount + " CRITICAL";
        }
        const monitoredBadge = Array.from(
          activeCard.querySelectorAll("span"),
        ).find(function (span) {
          return /^\d+\s+MONITORED$/.test(span.textContent.trim());
        });
        if (monitoredBadge) {
          monitoredBadge.textContent =
            Math.max(0, data.activeIncidentsCount - (criticalBadge
              ? Number(criticalBadge.textContent.split(" ")[0])
              : 0)) + " MONITORED";
        }
      }

      for (const label of SECTORS) {
        const sector = data.sectors.find(function (item) {
          return item.id === label.id;
        });
        if (!sector || sector.allocatedCapacityMw === null) continue;

        const card = findCard(label);
        if (!card) continue;

        card.setAttribute("data-crisisgrid-sector", sector.id);
        const ratio = sector.utilizationPercentage;
        const formatted =
          sector.allocatedCapacityMw.toFixed(1) +
          " / " +
          sector.maximumCapacityMw.toFixed(1) +
          " MW (" +
          ratio +
          "%)";
        for (const node of textLeaves()) {
          if (!card.contains(node)) continue;
          if (
            /^\s*\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*MW\s*\(\d+%\)\s*$/.test(
              node.textContent || "",
            )
          ) {
            node.textContent = formatted;
          }
        }

        const meter = card.querySelector('[style*="width"]');
        if (meter) meter.style.width = ratio + "%";

        const statusBadge = Array.from(card.querySelectorAll("span")).find(
          function (span) {
            return span.classList.contains("rounded-full") &&
              /^(stable|warning|critical|operational|elevated|surge)$/i.test(
                normalizeText(span.textContent),
              );
          },
        );
        if (statusBadge) {
          const labelNode = Array.from(statusBadge.childNodes).find(
            function (node) {
              return node.nodeType === Node.TEXT_NODE && node.textContent.trim();
            },
          );
          if (labelNode) {
            labelNode.textContent = " " +
              sector.operationalStatus.replace(/_/g, " ") +
              " ";
          }
        }

        const noteNodes = card.querySelectorAll(
          ".border-t > div > span:last-child",
        );
        if (noteNodes.length > 0) {
          noteNodes[0].textContent =
            sector.incidentImpactNotes[0] || sector.operationalNote;
        }
        if (noteNodes.length > 1) {
          noteNodes[1].textContent =
            sector.incidentImpactNotes[1] || sector.operationalNote;
        }
        card.setAttribute(
          "aria-label",
          sector.name +
            ": " +
            formatted +
            ", " +
            sector.operationalStatus +
            ". " +
            sector.operationalNote,
        );
      }

      updateCommandCenterMetrics(data);
      renderResponseStream(data);
      updateThreatTopography(data);
    }

    if (page.includes("authority_review_authorization")) {
      renderAuthorityReviewScreen(data);
    }

    if (page.includes("live_incidents_system_impact")) {
      setIncidentCounts(data);
      getSelectedIncident(data);
      updateIncidentFilterCounts(data);
      renderIncidentList(data);
      renderIncidentDetails(data);
      if (selectedIncidentAnalysis?.incident?.id === selectedIncidentId) {
        renderDynamicAllocationModel(selectedIncidentAnalysis);
      }
    }
  }

  function metricValue(label) {
    const card = findCard({ names: [label] });
    return card?.querySelector(".font-headline-md") || null;
  }

  function updateMetricNumber(value, number) {
    if (!value || !value.firstChild) return;
    value.firstChild.textContent = number.toLocaleString("en-US") + " ";
  }

  function updateCommandCenterMetrics(data) {
    const gridLoad = metricValue("Metropolitan Grid Load");
    updateMetricNumber(gridLoad, Math.round(data.cityGridLoadMw));
    const gridSuffix = gridLoad?.querySelector("span");
    if (gridSuffix) {
      gridSuffix.textContent =
        "/ " + data.cityGridCapacityMw.toLocaleString("en-US") + " MW";
    }

    const telemetry = metricValue("Telemetry Nodes Active");
    updateMetricNumber(telemetry, data.telemetryNodesActive);
    const telemetrySuffix = telemetry?.querySelector("span");
    if (telemetrySuffix) {
      telemetrySuffix.textContent =
        data.telemetryOnlinePercentage.toFixed(1) + "% Online";
    }

    const responseUnits = metricValue("Emergency Response Units");
    updateMetricNumber(responseUnits, data.emergencyResponseUnitsDeployed);
  }

  function renderResponseStream(data) {
    const body = document.querySelector("main table tbody");
    if (!body) return;
    const refreshLabel = Array.from(document.querySelectorAll("main span")).find(
      function (span) {
        return /AUTO-REFRESH:/i.test(span.textContent);
      },
    );
    if (refreshLabel) refreshLabel.textContent = "AUTO-REFRESH: 15s";

    const incidents = data.incidents.filter(function (incident) {
      return incident.status === "active";
    });
    body.replaceChildren();

    if (incidents.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "py-4 text-on-surface-variant";
      cell.colSpan = 6;
      cell.textContent = "No active incidents are currently recorded.";
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }

    for (const incident of incidents) {
      const row = document.createElement("tr");
      row.className = "hover:bg-surface-container transition-colors";
      row.dataset.crisisgridIncident = incident.id;

      const code = document.createElement("td");
      code.className = "py-3 font-mono font-medium text-error";
      code.textContent = incident.incidentCode;
      row.appendChild(code);

      const description = document.createElement("td");
      description.className = "py-3";
      const title = document.createElement("div");
      title.className = "font-medium text-on-surface";
      title.textContent = incident.title;
      const location = document.createElement("div");
      location.className = "text-outline text-[11px]";
      location.textContent = incident.address || incident.location;
      description.append(title, location);
      row.appendChild(description);

      const priorityCell = document.createElement("td");
      priorityCell.className = "py-3";
      const priority = document.createElement("span");
      priority.className =
        incident.severity === "critical"
          ? "px-2 py-0.5 rounded text-[11px] font-semibold bg-error-container/20 text-error"
          : "px-2 py-0.5 rounded text-[11px] font-semibold bg-secondary-container/40 text-secondary-fixed";
      priority.textContent = incident.severity.toUpperCase();
      priorityCell.appendChild(priority);
      row.appendChild(priorityCell);

      const units = document.createElement("td");
      units.className = "py-3 font-mono text-on-surface-variant";
      units.textContent = incident.responseUnits + " units assigned";
      row.appendChild(units);

      const demand = document.createElement("td");
      demand.className = "py-3 font-mono text-on-surface";
      demand.textContent =
        "+" + incident.gridDemandImpactMw.toFixed(1) + " MW demand";
      row.appendChild(demand);

      const action = document.createElement("td");
      action.className = "py-3 text-right";
      const inspect = document.createElement("button");
      inspect.type = "button";
      inspect.className =
        "px-2.5 py-1 rounded bg-surface-container-high hover:bg-primary hover:text-on-primary text-on-surface transition-colors font-label-sm text-label-sm";
      inspect.dataset.crisisgridInspect = incident.id;
      inspect.textContent = "Inspect";
      action.appendChild(inspect);
      row.appendChild(action);
      body.appendChild(row);
    }
  }

  function updateThreatTopography(data) {
    const incident = data.incidents.find(function (item) {
      return item.status === "active" && item.latitude !== null &&
        item.longitude !== null;
    });
    const coordinate = Array.from(
      document.querySelectorAll("main .font-mono"),
    ).find(function (node) {
      return /LAT\s+[-\d.]+\s*[NS]\s*\/\s*LON/i.test(node.textContent);
    });
    if (coordinate) {
      coordinate.textContent = incident
        ? "LAT " +
          Math.abs(incident.latitude).toFixed(4) +
          (incident.latitude < 0 ? " S" : " N") +
          " / LON " +
          Math.abs(incident.longitude).toFixed(4) +
          (incident.longitude < 0 ? " W" : " E")
        : "Bengaluru Metropolitan Region";
    }

    const stability = findExactTextElement(["Grid Stability Index"]);
    const stabilityValue = stability?.parentElement?.querySelector(
      ".font-mono",
    );
    if (stabilityValue) {
      stabilityValue.textContent =
        data.gridStabilityIndex.toFixed(1) + " / 100";
    }
    const temperature = findExactTextElement(["Ambient Urban Temperature"]);
    const temperatureValue = temperature?.parentElement?.querySelector(
      ".font-mono",
    );
    if (temperatureValue) {
      temperatureValue.textContent =
        data.ambientTemperatureC.toFixed(1) + "° C";
    }
  }

  function openSelectedIncident(activeIncidents) {
    const incidentId = new URLSearchParams(window.location.search).get("incident");
    if (!incidentId) return;
    const incident = activeIncidents.find(function (item) {
      return item.id === incidentId;
    });
    const card = document.querySelector(
      '[data-crisisgrid-incident="' + CSS.escape(incidentId) + '"]',
    );
    if (!incident || !card) {
      showNotice("The selected incident is no longer active.", true, true);
      return;
    }
    card.tabIndex = -1;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("ring-2", "ring-primary");
  }

  function reportLoadError(error) {
    const message =
      "Live database unavailable. The exported screen is preview artwork only. " +
      (error instanceof Error ? error.message : "Check the server configuration.");
    if (message !== lastLoadError) showNotice(message, true, true);
    lastLoadError = message;
  }

  function consumePendingNotice() {
    try {
      const notice = window.sessionStorage.getItem("crisisgrid:notice");
      if (notice) {
        window.sessionStorage.removeItem("crisisgrid:notice");
        showNotice(notice, false, false);
      }
    } catch {
      showNotice(
        "The simulation completed. Refresh the dashboard to see the latest database state.",
        false,
        false,
      );
    }
  }

  async function refreshDashboard(showLoading) {
    if (showLoading) {
      showNotice("Loading live CRISISGRID simulation data…", false, true);
    }

    try {
      const result = await request("/api/dashboard");
      if (
        !result ||
        !Array.isArray(result.sectors) ||
        !Array.isArray(result.incidents)
      ) {
        throw new Error("The dashboard response is missing required simulation data.");
      }

      dashboard = result;
      lastLoadError = "";
      setIncidentCounts(dashboard);
      const notice = document.getElementById("crisisgrid-status");
      if (notice && notice.textContent.startsWith("Loading live")) notice.remove();
      if (window.location.pathname.includes("authority_review_authorization")) {
        try {
          const pendingRes = await request("/api/allocation-plans/pending-review");
          if (pendingRes && pendingRes.plan) {
            currentAuthorityPlan = pendingRes.plan;
          }
        } catch {
          // Fallback to dashboard recommendedPlan
        }
      }
      updateSectorCards(dashboard);
      if (window.location.pathname.includes("live_incidents_system_impact")) {
        await refreshSelectedIncidentAnalysis(dashboard);
      }
      return dashboard;
    } catch (error) {
      reportLoadError(error);
      return null;
    }
  }

  async function refreshSelectedIncidentAnalysis(data) {
    const incident = getSelectedIncident(data);
    if (!incident) {
      selectedIncidentAnalysis = null;
      return;
    }

    try {
      const analysis = await request(
        "/api/incidents/" + encodeURIComponent(incident.id) + "/analysis",
      );
      if (selectedIncidentId !== incident.id) return;
      selectedIncidentAnalysis = analysis;
      renderIncidentDetails(data);
      renderDynamicAllocationModel(analysis);
    } catch (error) {
      selectedIncidentAnalysis = null;
      if (selectedIncidentId === incident.id) {
        showNotice(
          error instanceof Error
            ? error.message
            : "Could not load the selected incident analysis.",
          true,
          true,
        );
      }
    }
  }

  function setBusy(element, state) {
    busy = state;
    if (!element) return;
    element.disabled = state;
    element.setAttribute("aria-busy", String(state));
  }

  function getCurrentPlanId() {
    return currentAuthorityPlan?.id || dashboard?.recommendedPlan?.id;
  }

  async function handleAuthorizeClick(button) {
    if (busy) return;
    const plan = currentAuthorityPlan || dashboard?.recommendedPlan;
    if (!plan) {
      showNotice("No pending allocation plan available.", true, true);
      return;
    }

    if (currentRole !== "AUTHORITY") {
      setBusy(button, true);
      try {
        await request("/api/allocation-plans/" + plan.id + "/review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({
            decision: "approve",
            role: currentRole,
            signerRole: currentSignerRole,
            reviewer: currentSignerRole,
          }),
        });
      } catch (err) {
        showNotice(
          "Access Denied (403): " +
            (err instanceof Error ? err.message : "Unauthorized user role.") +
            " Only AUTHORITY users can approve plans. Unauthorized attempt logged to audit trail.",
          true,
          true,
        );
      } finally {
        setBusy(button, false);
      }
      return;
    }

    const signatures = Array.isArray(plan.signatures) ? plan.signatures : [];
    const alreadySigned = signatures.some(function (s) {
      return s.signerRole === currentSignerRole;
    });

    if (alreadySigned) {
      showNotice(
        "Current signer (" +
          currentSignerRole +
          ") has already signed this plan. Switch to the other signer in the Demo Toolbar to complete dual quorum.",
        true,
        true,
      );
      return;
    }

    const nextQuorum = signatures.length + 1;
    const promptMsg =
      nextQuorum >= 2
        ? "CONFIRM FINAL DISPATCH DIRECTIVE\n\n" +
          "Signer: " +
          currentSignerRole +
          " (" +
          SIGNER_PROFILES[currentSignerRole].name +
          ")\n" +
          "Action: Final Dual-Key Authorization (2 of 2 Signed)\n\n" +
          "This will mark the plan APPROVED, update sector allocations in the grid, and commit to the immutable ledger.\n\n" +
          "Principle: CRISISGRID RECOMMENDS. HUMANS DECIDE.\n\n" +
          "Proceed?"
        : "CONFIRM SIGNATURE\n\n" +
          "Signer: " +
          currentSignerRole +
          " (" +
          SIGNER_PROFILES[currentSignerRole].name +
          ")\n" +
          "Action: Record First Dual-Key Signature (1 of 2 Signed)\n\n" +
          "Plan will remain in PENDING_REVIEW until second authority sign-off is completed.\n\n" +
          "Proceed?";

    if (!window.confirm(promptMsg)) return;

    setBusy(button, true);
    try {
      const result = await request(
        "/api/allocation-plans/" + plan.id + "/review",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({
            decision: "approve",
            role: currentRole,
            signerRole: currentSignerRole,
            reviewer: currentSignerRole,
          }),
        },
      );

      if (result.plan) {
        currentAuthorityPlan = result.plan;
      }

      if (result.status === "approved") {
        showNotice(
          "Plan authorized and dispatched! Quorum 2/2 sealed. Synchronizing grid transformers...",
          false,
          true,
        );
        const toast = document.getElementById("signature-toast");
        if (toast) {
          const toastTitle = document.getElementById("signature-toast-title");
          const toastMeta = document.getElementById("signature-toast-meta");
          if (toastTitle)
            toastTitle.textContent = "Dispatch Authorized & Sealed";
          if (toastMeta) {
            toastMeta.textContent =
              "Ledger block committed. Approved by " +
              SIGNER_PROFILES[currentSignerRole].name;
          }
          toast.classList.remove("hidden");
        }
        await refreshDashboard(false);
        setTimeout(function () {
          window.location.assign(PAGE_PATHS.allocation_confirmed_dispatched);
        }, 1600);
      } else {
        showNotice(
          result.message ||
            "Signature recorded (1 of 2 signed). Awaiting second authority sign-off.",
          false,
          false,
        );
        await refreshDashboard(false);
      }
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Failed to record authorization.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function handleRejectClick(button) {
    if (busy) return;
    const plan = currentAuthorityPlan || dashboard?.recommendedPlan;
    if (!plan) {
      showNotice("No allocation plan to reject.", true, true);
      return;
    }

    if (currentRole !== "AUTHORITY") {
      setBusy(button, true);
      try {
        await request("/api/allocation-plans/" + plan.id + "/review", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({
            decision: "reject",
            role: currentRole,
            signerRole: currentSignerRole,
            reviewer: currentSignerRole,
          }),
        });
      } catch (err) {
        showNotice(
          "Access Denied (403): " +
            (err instanceof Error ? err.message : "Unauthorized user role.") +
            " Only AUTHORITY users can reject plans. Unauthorized attempt logged to audit trail.",
          true,
          true,
        );
      } finally {
        setBusy(button, false);
      }
      return;
    }

    if (
      !window.confirm(
        "REJECT RECOMMENDATION & MAINTAIN BASELINE\n\n" +
          "Are you sure you wish to reject this automated allocation plan?\n\n" +
          "Existing active grid allocations will remain active. Action will be logged to immutable municipal audit ledger.",
      )
    ) {
      return;
    }

    setBusy(button, true);
    try {
      const result = await request(
        "/api/allocation-plans/" + plan.id + "/review",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({
            decision: "reject",
            role: currentRole,
            signerRole: currentSignerRole,
            reviewer: currentSignerRole,
          }),
        },
      );

      if (result.plan) {
        currentAuthorityPlan = result.plan;
      }
      showNotice(
        "Recommendation rejected. Existing baseline allocations maintained and locked.",
        false,
        true,
      );
      await refreshDashboard(false);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Failed to reject plan.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function handleApplyModifierClick(button) {
    if (busy) return;
    const plan = currentAuthorityPlan || dashboard?.recommendedPlan;
    if (!plan) {
      showNotice("No plan to modify.", true, true);
      return;
    }

    if (currentRole === "CITIZEN") {
      showNotice(
        "Access Denied (403): Citizens have read-only access and cannot modify allocation parameters.",
        true,
        true,
      );
      return;
    }

    const hospital = parseFloat(
      document.getElementById("range-hospital")?.value || "17",
    );
    const water = parseFloat(
      document.getElementById("range-water")?.value || "12",
    );
    const telecom = parseFloat(
      document.getElementById("range-telecom")?.value || "5",
    );
    const emergencyOps = parseFloat(
      document.getElementById("range-emergency-ops")?.value || "11",
    );
    const priority = parseInt(
      document.getElementById("mod-incident-priority")?.value || "5",
      10,
    );
    const demandDelta = parseFloat(
      document.getElementById("mod-demand-delta")?.value || "0",
    );

    const total = hospital + water + telecom + emergencyOps;
    if (total > 45.001) {
      showNotice(
        "Cannot apply modifications: Total capacity (" +
          total.toFixed(1) +
          " MW) exceeds 45.0 MW limit.",
        true,
        true,
      );
      return;
    }

    if (
      hospital < 15.5 ||
      water < 8.0 ||
      telecom < 4.5 ||
      emergencyOps < 8.0
    ) {
      showNotice(
        "Cannot apply modifications: Critical sector safety floors violated.",
        true,
        true,
      );
      return;
    }

    setBusy(button, true);
    try {
      const result = await request(
        "/api/allocation-plans/" + plan.id + "/modify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({
            sectorAllocations: [
              { sectorId: "hospital_network", allocatedCapacityMw: hospital },
              { sectorId: "water_infrastructure", allocatedCapacityMw: water },
              { sectorId: "telecommunications", allocatedCapacityMw: telecom },
              {
                sectorId: "emergency_operations",
                allocatedCapacityMw: emergencyOps,
              },
            ],
            incidentPriority: priority,
            emergencyDemandDeltaMw: demandDelta,
            role: currentRole,
            reviewer: currentSignerRole,
          }),
        },
      );

      document.getElementById("modifier-modal")?.classList.add("hidden");
      if (result.plan) {
        currentAuthorityPlan = result.plan;
      }
      showNotice(
        result.message ||
          "Allocation parameters modified and dynamic allocation engine rerun.",
        false,
        false,
      );
      await refreshDashboard(false);
    } catch (err) {
      showNotice(
        err instanceof Error
          ? err.message
          : "Failed to modify allocation parameters.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function handleResetSignaturesClick(count, button) {
    if (busy) return;
    const plan = currentAuthorityPlan || dashboard?.recommendedPlan;
    if (!plan) return;

    setBusy(button, true);
    try {
      const result = await request(
        "/api/allocation-plans/" + plan.id + "/reset-signatures",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentRole,
          },
          body: JSON.stringify({ count, role: currentRole }),
        },
      );
      if (result.plan) {
        currentAuthorityPlan = result.plan;
      }
      showNotice(
        "Demo Preset Applied: Plan signatures reset to " +
          count +
          " of 2 signed.",
        false,
        false,
      );
      await refreshDashboard(false);
    } catch (err) {
      showNotice(
        err instanceof Error ? err.message : "Could not reset signatures.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function reRunRecommendation(button) {
    if (busy) return;
    setBusy(button, true);
    try {
      const result = await request("/api/allocation-plans/recommend", {
        method: "POST",
      });
      await refreshDashboard(false);
      const simulation = result.simulation;
      const factors =
        simulation && Array.isArray(simulation.decisionFactors)
          ? simulation.decisionFactors
          : [];
      const summary =
        simulation &&
        typeof simulation.totalAllocated === "number" &&
        typeof simulation.totalAvailableCapacity === "number" &&
        typeof simulation.balance === "number"
          ? "Allocation " +
            simulation.status +
            ": " +
            simulation.totalAllocated.toFixed(1) +
            " / " +
            simulation.totalAvailableCapacity.toFixed(1) +
            " MW; balance " +
            Number(simulation.balance).toFixed(1) +
            " MW. "
          : "";
      const warnings =
        simulation && Array.isArray(simulation.warnings)
          ? simulation.warnings
          : [];
      showNotice(
        factors.length > 0 || summary
          ? "Deterministic allocation completed. " +
            summary +
            factors.concat(warnings).join(" ")
          : "Recommendation recalculated from active incidents and sector demand.",
        false,
        false,
      );
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Could not recalculate the recommendation.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  function readModifiedItems() {
    const ranges = document.querySelectorAll(
      '#modifier-modal input[type="range"]',
    );
    if (ranges.length !== 3) {
      throw new Error(
        "The authority screen does not contain all expected allocation controls.",
      );
    }
    const result = [
      {
        sectorId: "hospital_network",
        allocatedCapacityMw: Number(ranges[0].value),
      },
      {
        sectorId: "water_infrastructure",
        allocatedCapacityMw: Number(ranges[1].value),
      },
      {
        sectorId: "telecommunications",
        allocatedCapacityMw: Number(ranges[2].value),
      },
    ];
    const emergencyOperations = dashboard?.recommendedPlan?.items?.emergency_operations;
    if (typeof emergencyOperations !== "number") {
      throw new Error("The current plan has no emergency-operations allocation.");
    }
    result.push({
      sectorId: "emergency_operations",
      allocatedCapacityMw: emergencyOperations,
    });
    const total = result.reduce(function (sum, item) {
      return sum + item.allocatedCapacityMw;
    }, 0);
    if (total > 45) {
      throw new Error(
        "The modified allocations exceed the 45 MW emergency capacity limit.",
      );
    }
    return result;
  }

  function wireNavigation() {
    for (const anchor of document.querySelectorAll('a[href="#"]')) {
      const label = anchor.textContent.replace(/\s+/g, " ").trim();
      if (/Command Overview|Command Center|Return to Command Center/i.test(label)) {
        anchor.href = PAGE_PATHS.city_command_center;
      } else if (/Live Incidents & Impact|Incident Management Hub/i.test(label)) {
        anchor.href = PAGE_PATHS.live_incidents_system_impact;
      } else if (/Authority Review/i.test(label)) {
        anchor.href = PAGE_PATHS.authority_review_authorization;
      }
    }
  }

  function readSessionJson(key, fallback) {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeSession(key, value) {
    try {
      window.sessionStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    } catch {
      showNotice("This browser could not store the report draft locally.", true, true);
    }
  }

  function categoryFromLabel(label) {
    const text = label.replace(/\s+/g, " ").toLowerCase();
    if (text.includes("civic hazard") || text.includes("infrastructure safety")) {
      return { category: "civic_hazard", incidentType: "infrastructure" };
    }
    if (text.includes("fire rescue") || (text.includes("fire") && text.includes("hazard"))) {
      return { category: "fire_rescue", incidentType: "fire" };
    }
    if (text.includes("disaster") || text.includes("evacuation") || text.includes("flood")) {
      return { category: "disaster", incidentType: "flood" };
    }
    if (text.includes("medical") || text.includes("ambulance") || text.includes("trauma")) {
      return { category: "medical", incidentType: "medical" };
    }
    return null;
  }

  function applyLocationToScreen(location) {
    const locationLabel = Array.from(document.querySelectorAll("span")).find(
      function (node) {
        return /Indiranagar, 100ft Rd|GPS lock|Current Location Detected/i.test(
          node.textContent,
        );
      },
    );
    if (locationLabel && /Indiranagar, 100ft Rd/i.test(locationLabel.textContent)) {
      locationLabel.textContent = location.location;
    }
    const accuracy = Array.from(document.querySelectorAll("span")).find(
      function (node) {
        return /GPS lock|GPS High Precision/i.test(node.textContent);
      },
    );
    if (accuracy) {
      accuracy.textContent =
        location.source === "geolocation"
          ? "GPS lock from this browser"
          : location.source === "manual_fallback"
            ? "Manual demo location"
            : "Demo fallback location";
    }
    const coordinate = Array.from(document.querySelectorAll(".font-mono")).find(
      function (node) {
        return /12\.9716/.test(node.textContent) || /° N/.test(node.textContent);
      },
    );
    if (coordinate && location.latitude != null && location.longitude != null) {
      coordinate.textContent =
        location.latitude.toFixed(4) +
        "° N, " +
        location.longitude.toFixed(4) +
        "° E";
    }
    const address = Array.from(document.querySelectorAll("p")).find(
      function (node) {
        return /HAL 2nd Stage, Indiranagar/i.test(node.textContent);
      },
    );
    if (address) address.textContent = location.address;
    const map = document.querySelector("[data-location]");
    if (map) map.setAttribute("data-location", location.location);
  }

  function captureBrowserLocation() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ ...FALLBACK_LOCATION, source: "demo_fallback" });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (position) {
          resolve({
            location: "Browser geolocation",
            address:
              "Approximate coordinates " +
              position.coords.latitude.toFixed(5) +
              ", " +
              position.coords.longitude.toFixed(5),
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            source: "geolocation",
          });
        },
        function () {
          resolve({ ...FALLBACK_LOCATION, source: "demo_fallback" });
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 30_000 },
      );
    });
  }

  function promptFallbackLocation(current) {
    const next = window.prompt(
      "Enter a demo location. Browser geolocation was not used or was unavailable.",
      current.address || current.location,
    );
    if (!next || !next.trim()) return current;
    return {
      location: next.trim().slice(0, 160),
      address: next.trim().slice(0, 240),
      latitude: current.latitude ?? FALLBACK_LOCATION.latitude,
      longitude: current.longitude ?? FALLBACK_LOCATION.longitude,
      source: "manual_fallback",
    };
  }

  function speechEngine() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    return SpeechRecognition ? new SpeechRecognition() : null;
  }

  function startSpeechToText(onTranscript) {
    const recognition = speechEngine();
    if (!recognition) {
      showNotice(
        "Browser speech-to-text is not available here. Type the details instead. This screen does not place a telephone call.",
        true,
        true,
      );
      return null;
    }
    recognition.lang = "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = function (event) {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      onTranscript(transcript.trim(), event.results[event.results.length - 1].isFinal);
    };
    recognition.onerror = function () {
      showNotice(
        "Speech capture stopped. You can type the emergency details. This is not a phone dispatch line.",
        true,
        true,
      );
    };
    try {
      recognition.start();
      showNotice(
        "Listening in this browser. This is in-app speech-to-text, not a call to 112 or emergency services.",
        false,
        true,
      );
      return recognition;
    } catch {
      showNotice("Speech capture could not start. Type the details instead.", true, true);
      return null;
    }
  }

  function wireSimulationHotlines() {
    document.addEventListener(
      "click",
      function (event) {
        const anchor = event.target.closest("a[href^='tel:']");
        if (!anchor) return;
        event.preventDefault();
        showNotice(
          "This demo does not place a telephone call and does not connect to police, ambulance, fire, 112, or government dispatch. Use the in-app emergency report.",
          false,
          true,
        );
      },
      true,
    );
  }

  function wireCitizenReport() {
    wireSimulationHotlines();
    let location = readSessionJson("crisisgrid:location", { ...FALLBACK_LOCATION });
    applyLocationToScreen(location);
    void captureBrowserLocation().then(function (next) {
      location = next;
      writeSession("crisisgrid:location", location);
      applyLocationToScreen(location);
    });

    const categorySection = document.querySelector(
      'section[aria-label="Emergency categories"]',
    );
    categorySection?.querySelectorAll("button").forEach(function (button) {
      button.addEventListener(
        "click",
        function (event) {
          const mapped = categoryFromLabel(button.textContent || "");
          if (!mapped) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          writeSession("crisisgrid:incidentType", mapped.incidentType);
          writeSession("crisisgrid:category", mapped.category);
          window.location.assign(PAGE_PATHS.emergency_incident_intake);
        },
        true,
      );
    });

    const voiceButton = document.getElementById("voiceDispatchBtn");
    let recognition = null;
    voiceButton?.addEventListener(
      "click",
      function (event) {
        event.stopImmediatePropagation();
        if (recognition) {
          recognition.stop();
          recognition = null;
          return;
        }
        recognition = startSpeechToText(function (transcript, isFinal) {
          writeSession("crisisgrid:dictation", transcript);
          writeSession("crisisgrid:inputMode", "speech");
          if (isFinal) {
            showNotice(
              "Voice note captured in the app. Choose an emergency category to continue. This is not a telephone report.",
              false,
              false,
            );
          }
        });
      },
      true,
    );

    document.addEventListener(
      "click",
      function (event) {
        const button = event.target.closest("button");
        if (!button) return;
        const label = button.textContent.replace(/\s+/g, " ").trim();
        if (label !== "Update") return;
        event.preventDefault();
        void captureBrowserLocation().then(function (next) {
          location =
            next.source === "geolocation" ? next : promptFallbackLocation(next);
          writeSession("crisisgrid:location", location);
          applyLocationToScreen(location);
        });
      },
      true,
    );
  }

  function wireIntakeForm() {
    wireSimulationHotlines();
    const textarea = document.getElementById("incident-description");
    let incidentType = "other";
    let category = "civic_hazard";
    let severity = "critical";
    let inputMode = "text";
    let evidencePaths = [];
    let location = readSessionJson("crisisgrid:location", { ...FALLBACK_LOCATION });

    try {
      incidentType =
        window.sessionStorage.getItem("crisisgrid:incidentType") || incidentType;
      category = window.sessionStorage.getItem("crisisgrid:category") || category;
      inputMode = window.sessionStorage.getItem("crisisgrid:inputMode") || inputMode;
      const dictation = window.sessionStorage.getItem("crisisgrid:dictation");
      evidencePaths = readSessionJson("crisisgrid:evidencePaths", []);
      if (textarea && dictation && !textarea.value.trim()) {
        textarea.value = dictation;
        textarea.dispatchEvent(new Event("input"));
        inputMode = "speech";
      }
    } catch {
      showNotice("Incident category could not be restored; choose a category again.", true, true);
    }

    const copy = CATEGORY_COPY[incidentType];
    if (copy) {
      const title = Array.from(document.querySelectorAll("span")).find(
        function (node) {
          return node.textContent.trim() === "Medical Emergency";
        },
      );
      const badge = Array.from(document.querySelectorAll("span")).find(
        function (node) {
          return /Trauma \/ Immediate Care/i.test(node.textContent);
        },
      );
      if (title) title.textContent = copy.title;
      if (badge) badge.textContent = copy.badge;
    }

    applyLocationToScreen(location);
    void captureBrowserLocation().then(function (next) {
      if (location.source === "demo_fallback") {
        location = next;
        writeSession("crisisgrid:location", location);
        applyLocationToScreen(location);
      }
    });

    const selectedUrgency = document.querySelector(
      '.urgency-option[aria-checked="true"]',
    );
    if (selectedUrgency?.dataset.urgency === "urgent") severity = "urgent";
    if (selectedUrgency?.dataset.urgency === "non-immediate") severity = "stable";

    const dictateBtn = document.getElementById("voice-dictate-btn");
    let recognition = null;
    dictateBtn?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (recognition) {
          recognition.stop();
          recognition = null;
          return;
        }
        recognition = startSpeechToText(function (transcript, isFinal) {
          if (!textarea) return;
          textarea.value = transcript;
          textarea.dispatchEvent(new Event("input"));
          inputMode = textarea.value && inputMode === "text" ? "text_and_speech" : "speech";
          writeSession("crisisgrid:dictation", transcript);
          writeSession("crisisgrid:inputMode", inputMode);
          if (isFinal) {
            showNotice(
              "Dictation captured with browser speech-to-text. This is not a live emergency call.",
              false,
              false,
            );
          }
        });
      },
      true,
    );

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/jpeg,image/png,image/webp";
    fileInput.hidden = true;
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", function () {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        const contentBase64 = String(reader.result || "");
        void request("/api/emergency-reports/evidence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type || "image/jpeg",
            contentBase64,
          }),
        })
          .then(function (result) {
            if (result.stored && result.path) {
              evidencePaths = evidencePaths.concat(result.path).slice(0, 4);
              writeSession("crisisgrid:evidencePaths", evidencePaths);
            }
            showNotice(result.message, !result.stored, true);
          })
          .catch(function (error) {
            showNotice(
              error instanceof Error
                ? error.message
                : "Visual evidence could not be stored. You can still submit the report.",
              true,
              true,
            );
          });
      };
      reader.readAsDataURL(file);
    });

    document.addEventListener(
      "click",
      function (event) {
        const button = event.target.closest("button");
        if (!button) return;

        if (button.classList.contains("urgency-option")) {
          severity =
            button.dataset.urgency === "non-immediate"
              ? "stable"
              : button.dataset.urgency === "critical"
                ? "critical"
                : "urgent";
          return;
        }

        const label = button.textContent.replace(/\s+/g, " ").trim();
        if (/Add Photo/i.test(label)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          fileInput.click();
          return;
        }
        if (/Edit on map/i.test(label)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          location = promptFallbackLocation(location);
          writeSession("crisisgrid:location", location);
          applyLocationToScreen(location);
          return;
        }

        if (button.id !== "submit-incident-btn") return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (busy) return;

        const description = textarea?.value.trim() || "";
        if (description.length < 10) {
          showNotice("Please describe the emergency before submitting the report.", true, true);
          textarea?.focus();
          return;
        }

        setBusy(button, true);
        const originalLabel = button.textContent;
        button.textContent = "Submitting simulation report…";
        void request("/api/emergency-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            category,
            incidentType,
            urgency: severity,
            severity,
            location: location.location,
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            locationSource: location.source,
            inputMode,
            evidencePaths,
            isAnonymous: true,
          }),
        })
          .then(async function (result) {
            const ribbon = Array.from(document.querySelectorAll("span")).find(
              function (node) {
                return /Priority Dispatch Channel Active/i.test(node.textContent);
              },
            );
            const steps = Array.isArray(result.timeline) ? result.timeline : [];
            for (const step of steps) {
              if (ribbon) ribbon.textContent = step.label;
              showNotice(
                step.label +
                  ". " +
                  (step.note || result.dispatchDisclaimer || ""),
                false,
                true,
              );
              await new Promise(function (resolve) {
                window.setTimeout(resolve, 450);
              });
            }
            const notice =
              "Report " +
              (result.incidentCode || result.incidentId) +
              " is on Live Incidents. " +
              (result.confirmationLabel || "TRIAGED") +
              ". Simulation only — not connected to 112 or municipal dispatch.";
            try {
              window.sessionStorage.setItem("crisisgrid:notice", notice);
            } catch {
              showNotice(notice, false, false);
            }
            window.location.assign(
              PAGE_PATHS.live_incidents_system_impact +
                (result.incidentId
                  ? "?incident=" + encodeURIComponent(result.incidentId)
                  : ""),
            );
          })
          .catch(function (error) {
            showNotice(
              error instanceof Error ? error.message : "Could not submit the incident report.",
              true,
              true,
            );
          })
          .finally(function () {
            setBusy(button, false);
            button.textContent = originalLabel;
          });
      },
      true,
    );
  }

  function wireAuthorityControls() {
    const approveButton = document.getElementById("authorize-btn");
    const rejectButton = document.getElementById("reject-btn");
    const modifyButton = document.getElementById("apply-modifier-btn");
    const openModButton = document.getElementById("open-modifier-btn");
    const closeModButton = document.getElementById("close-modifier-btn");
    const cancelModButton = document.getElementById("cancel-modifier-btn");
    const roleSelect = document.getElementById("demo-role-select");
    const signerSelect = document.getElementById("demo-signer-select");
    const reset0Btn = document.getElementById("demo-reset-0-btn");
    const reset1Btn = document.getElementById("demo-reset-1-btn");
    const rerunButton = Array.from(document.querySelectorAll("button")).find(
      function (button) {
        return /re-run model/i.test(button.textContent);
      },
    );

    if (roleSelect) {
      roleSelect.addEventListener("change", function (e) {
        currentRole = e.target.value;
        if (dashboard) renderAuthorityReviewScreen(dashboard);
        showNotice(
          "Active User Role (RBAC) switched to: " +
            currentRole +
            (currentRole === "AUTHORITY"
              ? " (Clearance Tier-1: Authorized)"
              : " (403 will block approvals/rejections)"),
          false,
          false,
        );
      });
    }

    if (signerSelect) {
      signerSelect.addEventListener("change", function (e) {
        currentSignerRole = e.target.value;
        if (dashboard) renderAuthorityReviewScreen(dashboard);
        showNotice(
          "Active Demo Signer switched to: " + currentSignerRole,
          false,
          false,
        );
      });
    }

    if (reset0Btn) {
      reset0Btn.addEventListener("click", function () {
        void handleResetSignaturesClick(0, reset0Btn);
      });
    }

    if (reset1Btn) {
      reset1Btn.addEventListener("click", function () {
        void handleResetSignaturesClick(1, reset1Btn);
      });
    }

    const sliders = [
      "range-hospital",
      "range-water",
      "range-telecom",
      "range-emergency-ops",
      "mod-demand-delta",
    ];
    sliders.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", function () {
          el.dataset.userModified = "true";
          updateModifierModalCalculations();
        });
      }
    });

    const modal = document.getElementById("modifier-modal");
    if (openModButton && modal) {
      openModButton.addEventListener("click", function (e) {
        e.preventDefault();
        modal.classList.remove("hidden");
        updateModifierModalCalculations();
      });
    }
    if (closeModButton && modal) {
      closeModButton.addEventListener("click", function (e) {
        e.preventDefault();
        modal.classList.add("hidden");
      });
    }
    if (cancelModButton && modal) {
      cancelModButton.addEventListener("click", function (e) {
        e.preventDefault();
        modal.classList.add("hidden");
      });
    }

    document.addEventListener(
      "click",
      function (event) {
        const button = event.target.closest("button");
        if (!button) return;

        if (button === approveButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void handleAuthorizeClick(button);
        } else if (button === rejectButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void handleRejectClick(button);
        } else if (button === modifyButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void handleApplyModifierClick(button);
        } else if (button === rerunButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!busy) void reRunRecommendation(button);
        }
      },
      true,
    );
  }

  function wireCommandCenterControls() {
    const reserveButton = Array.from(document.querySelectorAll("button")).find(
      function (button) {
        return /initiate reserve transfer/i.test(button.textContent);
      },
    );

    document.addEventListener(
      "click",
      function (event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const inspectButton = target.closest("[data-crisisgrid-inspect]");
        if (inspectButton) {
          event.preventDefault();
          const incidentId = inspectButton.dataset.crisisgridInspect;
          if (incidentId) {
            window.location.assign(
              PAGE_PATHS.live_incidents_system_impact +
                "?incident=" +
                encodeURIComponent(incidentId),
            );
          }
          return;
        }

        const button = target.closest("button");
        if (button !== reserveButton || busy) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setBusy(button, true);
        showNotice("Requesting a simulated 1 MW reserve transfer…", false, true);
        void request("/api/reserve/transfer", { method: "POST" })
          .then(async function (result) {
            await refreshDashboard(false);
            showNotice(
              "Reserve transfer completed. Available emergency capacity is " +
                Number(result.transfer.availableCapacityMw).toFixed(1) +
                " MW. A new recommendation is awaiting authority review.",
              false,
              false,
            );
          })
          .catch(function (error) {
            showNotice(
              error instanceof Error
                ? error.message
                : "The reserve transfer could not be completed.",
              true,
              true,
            );
          })
          .finally(function () {
            setBusy(button, false);
          });
      },
      true,
    );
  }

  function wireIncidentScreenControls() {
    const filterButtons = Array.from(
      document.querySelectorAll("main button"),
    ).filter(function (button) {
      return /^(All Incidents|Critical|Escalated|Automated Triage)/i.test(
        normalizeText(button.textContent),
      );
    });
    const search = document.querySelector(
      'main input[placeholder="Filter by ID, zone, or asset..."]',
    );
    const overrideButton = document.getElementById("simulateBtn");
    const reviewLink = Array.from(document.querySelectorAll("main a")).find(
      function (anchor) {
        return /Send to Authority Review/i.test(anchor.textContent);
      },
    );

    filterButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        const label = normalizeText(button.textContent);
        incidentFilter = label.startsWith("Critical")
          ? "critical"
          : label.startsWith("Escalated")
            ? "escalated"
            : label.startsWith("Automated Triage")
              ? "triage"
              : "all";
        for (const candidate of filterButtons) {
          candidate.classList.toggle("bg-surface-container-high", candidate === button);
          candidate.classList.toggle("text-on-surface", candidate === button);
          candidate.classList.toggle("font-medium", candidate === button);
          candidate.classList.toggle("text-on-surface-variant", candidate !== button);
        }
        if (dashboard) renderIncidentList(dashboard);
      });
    });

    search?.addEventListener("input", function () {
      incidentSearch = search.value.trim();
      if (dashboard) renderIncidentList(dashboard);
    });

    document.addEventListener(
      "click",
      function (event) {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const article = target.closest("article[data-crisisgrid-incident]");
        const leftSection = getIncidentScreenSection("lg:col-span-5");
        if (article && leftSection?.contains(article)) {
          event.preventDefault();
          selectedIncidentId = article.dataset.crisisgridIncident;
          selectedIncidentAnalysis = null;
          const url = new URL(window.location.href);
          if (selectedIncidentId) {
            url.searchParams.set("incident", selectedIncidentId);
            window.history.replaceState(null, "", url);
          }
          if (dashboard) {
            renderIncidentList(dashboard);
            renderIncidentDetails(dashboard);
            void refreshSelectedIncidentAnalysis(dashboard);
          }
          return;
        }

        const button = target.closest("button");
        if (button === overrideButton) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!busy) void runManualOverride(overrideButton);
          return;
        }
        if (reviewLink && target.closest("a") === reviewLink) {
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!busy) void sendIncidentForReview(reviewLink);
        }
      },
      true,
    );
  }

  async function sendIncidentForReview(button) {
    if (!selectedIncidentId) {
      showNotice("Select an incident before requesting authority review.", true, true);
      return;
    }
    setBusy(button, true);
    try {
      const result = await request(
        "/api/incidents/" +
          encodeURIComponent(selectedIncidentId) +
          "/authority-review",
        { method: "POST" },
      );
      const message =
        "Allocation plan " +
        result.planId +
        " is saved as PENDING_REVIEW and available in Authority Review.";
      try {
        window.sessionStorage.setItem("crisisgrid:notice", message);
      } catch {
        showNotice(message, false, false);
      }
      window.location.assign(PAGE_PATHS.authority_review_authorization);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Could not submit the incident for authority review.",
        true,
        true,
      );
    } finally {
      setBusy(button, false);
    }
  }

  async function runManualOverride(button) {
    if (!selectedIncidentId) {
      showNotice("Select an active incident before simulating a manual override.", true, true);
      return;
    }
    const incident = dashboard?.incidents.find(
      (item) => item.id === selectedIncidentId,
    );
    if (!incident || incident.status !== "active") {
      showNotice("Manual overrides are available only for active incidents.", true, true);
      return;
    }

    const options = dashboard.sectors.map(function (sector) {
      return sector.id + " (" + sector.name + "; floor " +
        sector.minimumSafeCapacityMw.toFixed(1) + " MW, max " +
        sector.maximumCapacityMw.toFixed(1) + " MW)";
    }).join("\n");
    const sectorId = window.prompt(
      "Choose one sector for the manual override:\n" + options,
      "telecommunications",
    );
    if (!sectorId) return;
    const selectedSector = dashboard.sectors.find(function (sector) {
      return sector.id === sectorId.trim();
    });
    if (!selectedSector) {
      showNotice("Choose a sector ID from the list.", true, true);
      return;
    }
    const requested = window.prompt(
      "Requested capacity for " +
        selectedSector.name +
        " in MW (minimum safe " +
        selectedSector.minimumSafeCapacityMw +
        " MW; maximum " +
        selectedSector.maximumCapacityMw +
        " MW):",
      String(selectedSector.allocatedCapacityMw ?? selectedSector.baselineDemandMw),
    );
    if (requested === null || requested.trim() === "") return;
    const requestedCapacityMw = Number(requested);
    if (!Number.isFinite(requestedCapacityMw)) {
      showNotice("Enter a valid numeric allocation in MW.", true, true);
      return;
    }

    let token = "";
    try {
      token = window.sessionStorage.getItem("crisisgrid:authority-token") || "";
    } catch {
      showNotice("The browser could not access session storage for authority credentials.", true, true);
      return;
    }
    if (!token) {
      token = window.prompt("Enter the configured demo authority token:") || "";
      if (!token) return;
      try {
        window.sessionStorage.setItem("crisisgrid:authority-token", token);
      } catch {
        showNotice("The browser could not store the demo authority token for this session.", true, true);
        return;
      }
    }

    setBusy(button, true);
    try {
      const result = await request(
        "/api/incidents/" +
          encodeURIComponent(selectedIncidentId) +
          "/manual-override",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Crisisgrid-Authority-Token": token,
          },
          body: JSON.stringify({
            sectorId: selectedSector.id,
            requestedCapacityMw,
          }),
        },
      );
      await refreshDashboard(false);
      const warnings = result.simulation?.warnings || [];
      showNotice(
        "Manual override saved as PENDING_REVIEW. " +
          "Allocation " +
          result.simulation.totalAllocated.toFixed(1) +
          " / " +
          result.simulation.totalAvailableCapacity.toFixed(1) +
          " MW. " +
          warnings.join(" "),
        false,
        false,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The manual override could not be saved.";
      if (/valid demo authority token/i.test(message)) {
        try {
          window.sessionStorage.removeItem("crisisgrid:authority-token");
        } catch {
          showNotice(message, true, true);
          return;
        }
      }
      showNotice(message, true, true);
    } finally {
      setBusy(button, false);
    }
  }

  async function start() {
    wireNavigation();
    consumePendingNotice();

    if (window.location.pathname.includes("city_command_center")) {
      wireCommandCenterControls();
    }
    if (window.location.pathname.includes("live_incidents_system_impact")) {
      wireIncidentScreenControls();
    }
    if (window.location.pathname.includes("citizen_emergency_home")) {
      wireCitizenReport();
    }
    if (window.location.pathname.includes("emergency_incident_intake")) {
      wireIntakeForm();
    }
    if (window.location.pathname.includes("authority_review_authorization")) {
      wireAuthorityControls();
    }

    try {
      await refreshDashboard(true);
    } catch {
      return;
    }

    window.setInterval(function () {
      void refreshDashboard(false);
    }, 15_000);
  }

  void start();
})();
