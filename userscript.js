// ==UserScript==
// @name         GeoFS Fuel
// @namespace    https://github.com/tylerbmusic/GeoFS-Fuel
// @version      0.1.7
// @description  Adds fuel to GeoFS (requested by many, made with some help from geofs_pilot) - Custom Vertical UI (draggable & save positions) + H triple-hide / single-show
// @author       GGamerGGuy (modified)
// @match        https://www.geo-fs.com/geofs.php?v=*
// @match        https://*.geo-fs.com/geofs.php*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=geo-fs.com
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    window.fuel = {
        lastId: -1, //the aircraft's id as of the last tick
        kgph: -1, //aircraft's kilograms per hour
        capacity: -1, //aircraft's fuel capacity in kg
        left: -1, //fuel left in the tank in kg
        isRefueling: false, //whether or not the aircraft is refueling
        wasRefueling: false, //whether or not the aircraft was refueling as of the last tick
        refuelAmount: -1, //how much to refuel the aircraft to
        refuelTime: 1, //how long refueling should take, in minutes
        refuelPerSec: -1, //how much per second to refuel the aircraft to be able to fuel it in the given time
        nextTick: -1,
        firstAudio: new Audio("https://tylerbmusic.github.io/GPWS-files_geofs/fuelNotify.wav"),
    };
    window.GAL_TO_KG = 2.98; // Convert US gallons to kg (approximately)

    // Fuel consumption table for aircraft ID 2871 (altitude-based and throttle-based)
    // Format: consumption[throttlePercent][altitudeRange] = kg/h
    window.fuel.consumptionTable2871 = {
        0: { low: 0, mid: 0, high: 0 },           // 0%
        10: { low: 500, mid: 560, high: 640 },     // 10%
        20: { low: 700, mid: 800, high: 900 },     // 20%
        30: { low: 1100, mid: 1160, high: 1200 },  // 30%
        40: { low: 1700, mid: 1640, high: 1500 },  // 40%
        50: { low: 2400, mid: 2200, high: 1800 },  // 50%
        60: { low: 3200, mid: 2800, high: 2100 },  // 60%
        70: { low: 4100, mid: 3500, high: 2360 },  // 70%
        80: { low: 5000, mid: 4100, high: 2700 },  // 80%
        90: { low: 5700, mid: 4700, high: 3040 },  // 90%
        100: { low: 6200, mid: 5100, high: 3300 }  // 100%
    };

    //Addon menu code
    if (!window.gmenu || !window.GMenu) {
        fetch(
            "https://raw.githubusercontent.com/tylerbmusic/GeoFS-Addon-Menu/refs/heads/main/addonMenu.js"
        )
            .then((response) => response.text())
            .then((script) => {
            eval(script);
        })
            .then(() => {
            setTimeout(afterGMenu, 100);
        });
    } else afterGMenu()

    //Code to be executed once the addon menu code is loaded
    async function afterGMenu() {
        const m = new window.GMenu("Fuel", "fuel");
        m.addItem("Fuel low warning threshold %: ", "Threshold", "number", 0, "0.15", 'min=0 max=1 step=0.01');
        m.addItem("Refuel Amount (kg): ", "Amount", "number", 0, "0", `min=0`);
        m.addItem("Refuel Time (minutes): ", "Time", "number", 0, "1", 'min=0 step=0.1');
        m.addItem("Allow midair refueling: ", "AirRefuel", "checkbox", 0, "false");
        window.fuel.refuel = function() {
            window.fuel.refuelAmount = Math.min(Number(localStorage.getItem("fuelAmount")), window.fuel.capacity);
            window.fuel.refuelTime = Number(localStorage.getItem("fuelTime"));
            window.fuel.refuelPerSec = (window.fuel.refuelAmount - window.fuel.left)/(window.fuel.refuelTime*60);
            window.fuel.isRefueling = true;
            console.log("Refueling...");
        };
        m.addButton("REFUEL", window.fuel.refuel, 'onclick="window.fuel.refuel()"');
        let a = document.getElementsByClassName("geofs-alarms-container")[0];
        a.innerHTML += `<div class="geofs-inline-overlay geofs-textOverlay control-pad-transparent orange-pad control-pad-dyn-label geofs-hidden" style="background-size: 100px 25px; margin-left: 0px; margin-bottom: 0px; z-index: 60; background-position: 0px 0px; width: 100px; height: 25px; transform-origin: 0px 25px; opacity: 0.6; transform: rotate(0deg);" id="lowfuel">LOW FUEL</div>`;
        fWait();
    }
})();

//Wait for GeoFS to finish loading in everything before trying to get any values, to avoid errors
function fWait() {
    if (window.geofs.cautiousWithTerrain == false && window.geofs.aircraft.instance && window.geofs.animation) {
        setTimeout(() => {
            window.fuelInit();
        }, 3000);
    } else {
        setTimeout(() => {
            fWait();
        }, 1000);
    }
};

//Initialize the custom vertical fuel display
window.fuelInit = function() {
    setTimeout(() => {
        window.fuel.nextTick = Date.now()+1000;
        window.fuelTick();
    }, 3000);

    // Helper: make an element draggable and save position to localStorage
    function makeDraggable(el, storageKey) {
        if (!el) return;
        el.style.cursor = 'grab';
        el.style.touchAction = 'none';
        // If stored, apply
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const p = JSON.parse(stored);
                if (typeof p.left === 'number' && typeof p.top === 'number') {
                    el.style.left = p.left + 'px';
                    el.style.top = p.top + 'px';
                    el.style.right = 'auto';
                    el.style.bottom = 'auto';
                    el.style.position = 'fixed';
                }
            }
        } catch (e) {
            console.warn("Failed to parse stored position for", storageKey, e);
        }

        let dragging = false;
        let startX = 0, startY = 0, origLeft = 0, origTop = 0, pointerId = null;

        function onPointerDown(e) {
            e.preventDefault();
            dragging = true;
            pointerId = e.pointerId;
            el.setPointerCapture(pointerId);
            el.style.cursor = 'grabbing';
            const rect = el.getBoundingClientRect();
            // ensure left/top style exists
            if (!el.style.left || !el.style.top || el.style.right !== 'auto' || el.style.bottom !== 'auto') {
                // compute left/top from rect
                el.style.left = rect.left + 'px';
                el.style.top = rect.top + 'px';
                el.style.right = 'auto';
                el.style.bottom = 'auto';
                el.style.position = 'fixed';
            }
            startX = e.clientX;
            startY = e.clientY;
            origLeft = parseInt(el.style.left, 10);
            origTop = parseInt(el.style.top, 10);
            if (isNaN(origLeft)) origLeft = rect.left;
            if (isNaN(origTop)) origTop = rect.top;
        }

        function onPointerMove(e) {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            let newLeft = origLeft + dx;
            let newTop = origTop + dy;
            // clamp on screen
            newLeft = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, newTop));
            el.style.left = Math.round(newLeft) + 'px';
            el.style.top = Math.round(newTop) + 'px';
        }

        function onPointerUp(e) {
            if (!dragging) return;
            dragging = false;
            try { el.releasePointerCapture(pointerId); } catch (err) {}
            pointerId = null;
            el.style.cursor = 'grab';
            // save
            try {
                const left = parseInt(el.style.left, 10);
                const top = parseInt(el.style.top, 10);
                localStorage.setItem(storageKey, JSON.stringify({ left: left, top: top }));
            } catch (err) {
                console.warn("Failed to save position for", storageKey, err);
            }
        }

        el.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }

    // Restoring the original FUEL LEFT HUD element and give it a boxed style to match gauge
    var flightDataElement = document.getElementById('flightDataDisplay10');
    if (!flightDataElement) {
        flightDataElement = document.createElement('div');
        flightDataElement.id = 'flightDataDisplay10';
        // boxed style similar to the gauge
        flightDataElement.style.position = 'fixed';
        flightDataElement.style.bottom = '40px';
        flightDataElement.style.right = 'calc(10px + 48px + 16px + 100px)';
        flightDataElement.style.height = '36px';
        flightDataElement.style.minWidth = '120px';
        flightDataElement.style.padding = '6px 12px';
        flightDataElement.style.display = 'inline-block';
        // enforce Consolas/Menlo/monospace with !important
        flightDataElement.style.setProperty('font-family', "'Consolas','Menlo',monospace", 'important');
        flightDataElement.style.fontSize = '14px';
        flightDataElement.style.textTransform = 'uppercase';
        flightDataElement.style.overflow = 'hidden';
        flightDataElement.style.willChange = 'box-shadow';
        flightDataElement.style.transition = 'box-shadow .2s cubic-bezier(.4,0,1,1), background-color .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1)';
        flightDataElement.style.textAlign = 'center';
        flightDataElement.style.lineHeight = '24px';
        flightDataElement.style.verticalAlign = 'middle';
        flightDataElement.style.zIndex = '9999';
        // Box visual
        flightDataElement.style.backgroundColor = '#000000';
        flightDataElement.style.border = '1px solid #2e3035';
        flightDataElement.style.borderRadius = '3px';
        flightDataElement.style.color = 'white';
        flightDataElement.style.boxShadow = '0px 2px 5px rgba(0,0,0,0.5)';
        flightDataElement.style.opacity = '0.6';
        document.body.appendChild(flightDataElement);
    }
    // Fill initial content (will be updated by tick)
    flightDataElement.innerHTML = `
        <span style="background: 0 0; border: none; border-radius: 2px; color: #fff; display: inline-block; padding: 0 8px;" id="fuelL">FUEL LEFT:  ${Math.round(100*(window.fuel.left/window.fuel.capacity))}%</span>
    `;

    // Build the new UI elements
    var verticalGauge = document.getElementById('verticalFuelGauge');
    if (!verticalGauge) {
        verticalGauge = document.createElement('div');
        verticalGauge.id = 'verticalFuelGauge';
        verticalGauge.style.position = 'fixed';
        verticalGauge.style.bottom = '40px'; // Kept cleanly in the bottom right corner by default
        verticalGauge.style.right = '40px';
        verticalGauge.style.width = '45px';
        verticalGauge.style.backgroundColor = '#000000';
        verticalGauge.style.border = '1px solid #2e3035';
        verticalGauge.style.borderRadius = '3px';
        verticalGauge.style.display = 'flex';
        verticalGauge.style.flexDirection = 'column';
        verticalGauge.style.alignItems = 'center';
        verticalGauge.style.padding = '6px 4px';
        verticalGauge.style.zIndex = '9999';
        // enforce Consolas/Menlo/monospace with !important
        verticalGauge.style.setProperty('font-family', "'Consolas','Menlo',monospace", 'important');
        verticalGauge.style.color = 'white';
        verticalGauge.style.boxShadow = '0px 2px 5px rgba(0,0,0,0.5)';
        verticalGauge.style.opacity = '0.6'; // Setting overall opacity to 0.6

        // Inner HTML simulating the bar, arrow, and text structure with matched fonts
        verticalGauge.innerHTML = `
            <div style="font-size: 11px; font-weight: normal; letter-spacing: 1px; margin-bottom: 6px; text-shadow: 1px 1px 1px #000;">FUEL</div>
            <div style="position: relative; width: 16px; height: 100px; background: linear-gradient(to top, #e72525 0%, #e72525 15%, #f2d129 15%, #f2d129 30%, #179326 30%, #179326 100%);">
                <div id="fuelMask" style="position: absolute; top: 0; left: 0; width: 100%; height: 0%; background-color: #2a2c30;"></div>
                <div id="fuelArrow" style="position: absolute; bottom: 100%; right: -15px; width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent; border-right: 12px solid white; transform: translateY(50%); transition: bottom 0.5s ease-out;"></div>
            </div>
            <div id="fuelPctText" style="font-size: 13px; font-weight: bold; letter-spacing: 0.5px; margin-top: 6px; text-shadow: 1px 1px 1px #000;">100%</div>
        `;
        document.body.appendChild(verticalGauge);
    }

    // make both draggable and restore saved positions (if any)
    makeDraggable(verticalGauge, "fuelGaugePos");
    makeDraggable(flightDataElement, "fuelLeftPos");

    // -------------------------
    // H triple-press hide / single-show logic
    // -------------------------
    (function installHHandler() {
        const H_MULTI_PRESS_INTERVAL = 500; // ms
        let hPressCount = 0;
        let hPressTimer = null;
        let hiddenByH = false;

        // store previous display values to restore exactly
        function getPrevDisplay(el) {
            return el.dataset.prevDisplay || (el.style.display ? el.style.display : getComputedStyle(el).display);
        }
        function savePrevDisplay(el) {
            const cur = el.style.display ? el.style.display : getComputedStyle(el).display;
            el.dataset.prevDisplay = cur;
        }

        function hideUI() {
            if (flightDataElement) {
                savePrevDisplay(flightDataElement);
                flightDataElement.style.display = 'none';
            }
            if (verticalGauge) {
                savePrevDisplay(verticalGauge);
                verticalGauge.style.display = 'none';
            }
        }
        function showUI() {
            if (flightDataElement) {
                const prev = flightDataElement.dataset.prevDisplay || 'inline-block';
                flightDataElement.style.display = prev;
            }
            if (verticalGauge) {
                const prev = verticalGauge.dataset.prevDisplay || 'flex';
                verticalGauge.style.display = prev;
            }
        }

        function onKeyDown(e) {
            if (e.code !== 'KeyH') return;

            // If already hidden by triple-H, a single H press should show the UI
            if (hiddenByH) {
                showUI();
                hiddenByH = false;
                hPressCount = 0;
                if (hPressTimer) { clearTimeout(hPressTimer); hPressTimer = null; }
                e.preventDefault();
                return;
            }

            // Not hidden yet: count presses
            hPressCount++;
            if (hPressTimer) clearTimeout(hPressTimer);
            hPressTimer = setTimeout(() => { hPressCount = 0; hPressTimer = null; }, H_MULTI_PRESS_INTERVAL);

            if (hPressCount >= 3) {
                // hide UI, set flag
                hideUI();
                hiddenByH = true;
                hPressCount = 0;
                if (hPressTimer) { clearTimeout(hPressTimer); hPressTimer = null; }
            }

            e.preventDefault();
        }

        window.addEventListener('keydown', onKeyDown);
        // optionally expose a method to remove the handler if needed
        window.fuel._removeHHandler = function() { window.removeEventListener('keydown', onKeyDown); };
    })();
    // -------------------------

    if (!localStorage.getItem("fuelFirstTime")) {
        localStorage.setItem("fuelFirstTime", "false");
        window.fuel.firstAudio.play();
    }
}

// Helper function to get fuel consumption for aircraft 2871 based on altitude and throttle
window.fuel.getConsumption2871 = function(altitude, throttlePercent) {
    // Determine altitude range
    // FL100 = 10,000 ft, FL250 = 25,000 ft, FL390 = 39,000 ft
    let altitudeRange;
    if (altitude <= 10000) {
        altitudeRange = 'low';
    } else if (altitude <= 25000) {
        altitudeRange = 'mid';
    } else {
        altitudeRange = 'high';
    }

    // Round throttle to nearest 10% to match table
    let roundedThrottle = Math.round(throttlePercent / 10) * 10;
    roundedThrottle = Math.max(0, Math.min(100, roundedThrottle));

    // Get consumption from table
    const consumption = window.fuel.consumptionTable2871[roundedThrottle];
    if (consumption) {
        return consumption[altitudeRange];
    }
    return 0;
}

// Helper function to interpolate consumption based on exact throttle percentage
window.fuel.getConsumption2871Interpolated = function(altitude, throttlePercent) {
    // Determine altitude range
    let altitudeRange;
    if (altitude <= 10000) {
        altitudeRange = 'low';
    } else if (altitude <= 25000) {
        altitudeRange = 'mid';
    } else {
        altitudeRange = 'high';
    }

    // Clamp throttle between 0 and 100
    throttlePercent = Math.max(0, Math.min(100, throttlePercent));

    // Find the two closest throttle values in the table
    const throttleValues = Object.keys(window.fuel.consumptionTable2871).map(Number).sort((a, b) => a - b);
    
    let lower = throttleValues[0];
    let upper = throttleValues[throttleValues.length - 1];
    
    for (let i = 0; i < throttleValues.length - 1; i++) {
        if (throttlePercent >= throttleValues[i] && throttlePercent <= throttleValues[i + 1]) {
            lower = throttleValues[i];
            upper = throttleValues[i + 1];
            break;
        }
    }

    // If exact match, return it
    if (lower === upper) {
        return window.fuel.consumptionTable2871[lower][altitudeRange];
    }

    // Linear interpolation between two values
    const lowerConsumption = window.fuel.consumptionTable2871[lower][altitudeRange];
    const upperConsumption = window.fuel.consumptionTable2871[upper][altitudeRange];
    const ratio = (throttlePercent - lower) / (upper - lower);
    
    return lowerConsumption + (upperConsumption - lowerConsumption) * ratio;
}

//A function to be run every second
window.fuelTick = function() {
    const FUEL_DENSITY = 300; // Density of ATF Fuel in kg/m^3
    const GRAVITY = 9.81; // in m/s^2

    if (localStorage.getItem("fuelEnabled") == "true" && (Date.now() >= window.fuel.nextTick)) {
        window.fuel.nextTick += 1000;

        var lowAlarm = document.getElementById("lowfuel") || null;
        if (window.fuel.lastId != Number(window.geofs.aircraft.instance.id)) { //On aircraft change
            window.fuel.lastId = Number(window.geofs.aircraft.instance.id);
            let s = window.fuel.getStats(window.fuel.lastId);
            window.fuel.kgph = s[0];
            window.fuel.capacity = s[1];
            window.fuel.left = (window.fuel.capacity > 0) ? window.fuel.capacity / 2 : -1;
            window.fuel.isRefueling = false;
            // guard for element existence
            if (document.getElementById("fuelAmount")) {
                document.getElementById("fuelAmount").max = window.fuel.capacity;
            }
        }

        if (window.fuel.capacity > 0 && lowAlarm) {

            // Calculate the percentage
            let pct = Math.max(0, Math.min(100, (window.fuel.left / window.fuel.capacity) * 100));

            // Dynamically update the new gauge mask size, arrow placement, and percentage text
            let mask = document.getElementById('fuelMask');
            let arrow = document.getElementById('fuelArrow');
            let pctText = document.getElementById('fuelPctText');

            if (mask) mask.style.height = (100 - pct) + '%';
            if (arrow) arrow.style.bottom = pct + '%';
            if (pctText) pctText.innerText = Math.round(pct) + '%';

            // Restoring the dynamic update to the original FUEL LEFT string
            let flightDataElement = document.getElementById('flightDataDisplay10');
            if (flightDataElement) {
                flightDataElement.innerHTML = `
                    <span style="background: 0 0; border: none; border-radius: 2px; color: #fff; display: inline-block; padding: 0 8px;">FUEL LEFT: ${Math.round(window.fuel.left)}/${Math.round(window.fuel.capacity)} KG (${Math.round(pct)}%)</span>
                `;
            }

            if (window.fuel.left > 0) {
                // Determine fuel consumption rate based on aircraft type
                let fuelBurnRate = 0;

                if (window.fuel.lastId === 2871) {
                    // Special handling for aircraft 2871: use altitude and throttle-based consumption
                    if (window.geofs.aircraft.instance.engine.on && !window.geofs.isPaused()) {
                        // Get current altitude in feet and convert to match table (FL100 = 10,000 ft)
                        const altitude = window.geofs.aircraft.instance.rigidBody.position[2]; // altitude in feet
                        
                        // Get current throttle as percentage (0-1 range, convert to 0-100)
                        const throttlePercent = Math.abs(window.geofs.animation.values.smoothThrottle) * 100;
                        
                        // Get consumption in kg/h using interpolation
                        const consumptionKgPerHour = window.fuel.getConsumption2871Interpolated(altitude, throttlePercent);
                        
                        // Convert to kg/s
                        fuelBurnRate = consumptionKgPerHour / 3600;
                        
                        // Additional fuel burn for afterburners
                        if (window.geofs.animation.values.smoothThrottle > 0.9 && window.geofs.aircraft.instance.engines[0].afterBurnerThrust && window.geofs.aircraft.instance.engine.on) {
                            fuelBurnRate *= 2; // Afterburners burn 2x more fuel
                        }
                    }
                } else {
                    // Default behavior for other aircraft
                    if (window.geofs.aircraft.instance.engine.on && !window.geofs.isPaused()) {
                        fuelBurnRate = (window.fuel.kgph / 3600) * ((1/1.1) * Math.abs(window.geofs.animation.values.smoothThrottle + 0.1));
                    }
                    
                    // Add afterburner fuel consumption
                    if (window.geofs.animation.values.smoothThrottle > 0.9 && window.geofs.aircraft.instance.engines[0].afterBurnerThrust && window.geofs.aircraft.instance.engine.on && !window.geofs.isPaused()) {
                        fuelBurnRate += ((window.fuel.kgph * 2) / 3600) * ((1/1.1) * Math.abs(window.geofs.animation.values.smoothThrottle + 0.1));
                    }
                }

                window.fuel.left -= fuelBurnRate;

                // Sub routine to change Aircraft weight according to fuel left
                window.geofs.aircraft.instance.rigidBody.gravityForce[2] = -(window.geofs.aircraft.instance.rigidBody.mass * GRAVITY + window.fuel.left * (FUEL_DENSITY / 1000) * GRAVITY);

                let a = lowAlarm.className.split(" ");
                if ((window.fuel.left / window.fuel.capacity <= Number(localStorage.getItem("fuelThreshold"))) && a[5] == "geofs-hidden") {
                    a[5] = "geofs-visible";
                    lowAlarm.className = a.join(" ");
                } else if (a[5] == "geofs-visible") {
                    a[5] = "geofs-hidden";
                    lowAlarm.className = a.join(" ");
                }
            } else {
                window.geofs.aircraft.instance.stopEngine();
                window.controls.throttle = 0;
            }
        }

        if (window.fuel.isRefueling) {
            if ((Math.round(window.fuel.left*100)/100 != Math.round(window.fuel.refuelAmount*100)/100) && ((window.geofs.animation.values.groundContact && !window.geofs.aircraft.instance.engine.on && (window.geofs.animation.values.groundSpeed < 2)) || localStorage.getItem("fuelAirRefuel") == 'true')) {
                if (window.fuel.refuelPerSec > 0 && window.fuel.left >= window.fuel.refuelAmount) {
                    window.fuel.isRefueling = false;
                    window.fuel.left = window.fuel.refuelAmount; //Sometimes the fuel overfills lol
                    console.log("Stopped refueling");
                } else if (window.fuel.refuelPerSec < 0 && window.fuel.left <= window.fuel.refuelAmount) {
                    window.fuel.isRefueling = false;
                    window.fuel.left = window.fuel.refuelAmount; //Sometimes the fuel overfills lol
                    console.log("Stopped defueling");
                }
                window.fuel.left += window.fuel.refuelPerSec;
            } else if (!(window.geofs.animation.values.groundContact && !window.geofs.aircraft.instance.engine.on && (window.geofs.animation.values.groundSpeed < 2))) {
                window.fuel.isRefueling = false;
                alert("In order to refuel, you must be on the ground, your engines must be off, and you must be still");
            } else {
                window.fuel.isRefueling = false;
            }
        }
    }
    setTimeout(window.fuelTick, 10);
}

//@returns [kgph, capacity in kg]
window.fuel.getStats = function(id) {
    var ret;
    switch (id) {
        case 1:
            ret = [15, 36];
            break;
        case 2:
            ret = [27, 167];
            break;
        case 3:
            ret = [672, 1498];
            break;
        case 4:
            ret = [2067, 15375];
            break;
        case 5:
            ret = [373, 1251];
            break;
        case 6:
            ret = [257, 1128];
            break;
        case 7:
            ret = [3629, 3175];
            break;
        case 8:
            ret = [39, 104];
            break;
        case 9:
            ret = [224, 564];
            break;
        case 10:
            ret = [13729, 252378];
            break;
        case 11:
            ret = [12.8, 65.7];
            break;
        case 12:
            ret = [206, 188];
            break;
        case 13:
            ret = [84, 523];
            break;
        case 14:
            ret = [48, 24];
            break;
        case 15:
            ret = [358, 3468];
            break;
        case 16:
            ret = [732, 2454];
            break;
        case 18:
            ret = [869, 11320];
            break;
        case 20:
            ret = [20215, 94291];
            break;
        case 21:
            ret = [24, 48];
            break;
        case 22:
            ret = [16.4, 77.6];
            break;
        case 23:
            ret = [30, 143];
            break;
        case 24:
            ret = [7165, 111082];
            break;
        case 25:
            ret = [9597, 135040];
            break;
        case 26:
            ret = [298, 4309];
            break;
        case 27:
            ret = [2987, 6151];
            break;
        case 28:
            ret = [81, 346];
            break;
        case 31:
            ret = [51, 1261];
            break;
        case 40:
            ret = [15, 51];
            break;
        case 2871:
            ret = [1971, 21072];
            break;
        case 4646:
            ret = [2329, 31559];
            break;
        default:
            ret = [-1, -1];
            break;
    }
    return ret;
}
