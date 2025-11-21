async function setup() {
    const patchExportURL = "export/GS1.4.export.json";

    // Create AudioContext
    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();

    // Create gain node and connect it to audio output
    const outputNode = context.createGain();
    outputNode.gain.value = 1.0;
    outputNode.connect(context.destination);
    console.log("Audio output node created with gain:", outputNode.gain.value);
    
    // Fetch the exported patcher
    let response, patcher;
    try {
        response = await fetch(patchExportURL);
        patcher = await response.json();
    
        if (!window.RNBO) {
            // Load RNBO script dynamically
            // Note that you can skip this by knowing the RNBO version of your patch
            // beforehand and just include it using a <script> tag
            await loadRNBOScript(patcher.desc.meta.rnboversion);
        }

    } catch (err) {
        const errorContext = {
            error: err
        };
        if (response && (response.status >= 300 || response.status < 200)) {
            errorContext.header = `Couldn't load patcher export bundle`,
            errorContext.description = `Check app.js to see what file it's trying to load. Currently it's` +
            ` trying to load "${patchExportURL}". If that doesn't` + 
            ` match the name of the file you exported from RNBO, modify` + 
            ` patchExportURL in app.js.`;
        }
        if (typeof guardrails === "function") {
            guardrails(errorContext);
        } else {
            throw err;
        }
        return;
    }
    
    // (Optional) Fetch the dependencies
    let dependencies = [];
    try {
        const dependenciesResponse = await fetch("export/dependencies.json");
        dependencies = await dependenciesResponse.json();

        // Prepend "export" to any file dependenciies
        dependencies = dependencies.map(d => d.file ? Object.assign({}, d, { file: "export/" + d.file }) : d);
    } catch (e) {}

    // Create the device
    let device;
    try {
        device = await RNBO.createDevice({ context, patcher });
    } catch (err) {
        if (typeof guardrails === "function") {
            guardrails({ error: err });
        } else {
            throw err;
        }
        return;
    }

    // (Optional) Load the samples
    if (dependencies.length) {
        console.log("Loading audio dependencies:", dependencies);
        await device.loadDataBufferDependencies(dependencies);
        console.log("Audio dependencies loaded successfully");
    } else {
        console.warn("No audio dependencies found!");
    }

    // Connect the device to the web audio graph
    device.node.connect(outputNode);

    // (Optional) Extract the name and rnbo version of the patcher from the description
    document.getElementById("patcher-title").innerText = (patcher.desc.meta.filename || "Unnamed Patcher") + " (v" + patcher.desc.meta.rnboversion + ")";

    // Create custom transport controls (Play/Stop)
    makeTransportControls(device, context);

    // Create drum loop selector buttons
    makeDrumLoopButtons(device, context);

    // Create custom parameter controls (only cutoff, res, verb_send)
    makeCustomSliders(device);

    // (Optional) Create a form to send messages to RNBO inputs
    makeInportForm(device);

    // (Optional) Attach listeners to outports so you can log messages from the RNBO patcher
    attachOutports(device);

    // (Optional) Load presets, if any
    loadPresets(device, patcher);

    // Connect USB MIDI devices
    connectUSBMIDI(device);

    // Mobile-friendly audio context initialization
    const startAudioContext = async () => {
        if (context.state === 'suspended') {
            await context.resume();
        }
    };

    // Handle both click and touch events for mobile
    document.body.addEventListener('click', startAudioContext);
    document.body.addEventListener('touchstart', startAudioContext, { once: true });

    // Skip if you're not using guardrails.js
    if (typeof guardrails === "function")
        guardrails();
}

function loadRNBOScript(version) {
    return new Promise((resolve, reject) => {
        if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
            throw new Error("Patcher exported with a Debug Version!\nPlease specify the correct RNBO version to use in the code.");
        }
        const el = document.createElement("script");
        el.src = "https://c74-public.nyc3.digitaloceanspaces.com/rnbo/" + encodeURIComponent(version) + "/rnbo.min.js";
        el.onload = resolve;
        el.onerror = function(err) {
            console.log(err);
            reject(new Error("Failed to load rnbo.js v" + version));
        };
        document.body.append(el);
    });
}

function makeTransportControls(device, context) {
    const transportDiv = document.getElementById("transport-controls");
    if (!transportDiv) return;

    const loopSelectParam = device.parameters.find(p => p.id === "loop_select");
    if (!loopSelectParam) return;

    const playButton = document.createElement("button");
    playButton.textContent = "PLAY";
    playButton.className = "transport-button play-button";
    playButton.id = "play-button";

    const stopButton = document.createElement("button");
    stopButton.textContent = "STOP";
    stopButton.className = "transport-button stop-button";
    stopButton.id = "stop-button";

    let lastLoopValue = 1;

    const handlePlay = async () => {
        try {
            console.log("Play button pressed, context state:", context.state);
            await context.resume();
            console.log("Context resumed, new state:", context.state);

            // Start the transport
            device.node.context.transport.running = true;
            console.log("Transport running set to:", device.node.context.transport.running);

            loopSelectParam.value = lastLoopValue;
            console.log("Loop select set to:", lastLoopValue);
            console.log("Current loop_select parameter value:", loopSelectParam.value);

            playButton.classList.add("active");
            stopButton.classList.remove("active");
        } catch (err) {
            console.error("Error in handlePlay:", err);
        }
    };

    const handleStop = () => {
        loopSelectParam.value = 0;
        device.node.context.transport.running = false;
        console.log("Stop pressed, transport stopped, loop_select set to 0");
        stopButton.classList.add("active");
        playButton.classList.remove("active");
    };

    playButton.addEventListener("click", handlePlay);
    playButton.addEventListener("touchstart", handlePlay);

    stopButton.addEventListener("click", handleStop);
    stopButton.addEventListener("touchstart", handleStop);

    stopButton.classList.add("active");

    transportDiv.appendChild(playButton);
    transportDiv.appendChild(stopButton);

    window.updateLastLoopValue = (value) => {
        if (value > 0) {
            lastLoopValue = value;
        }
    };
}

function makeDrumLoopButtons(device, context) {
    const loopDiv = document.getElementById("drum-loop-buttons");
    if (!loopDiv) return;

    const loopSelectParam = device.parameters.find(p => p.id === "loop_select");
    if (!loopSelectParam) return;

    const drumLoops = [
        { name: "LOOP 1", value: 1 },
        { name: "LOOP 2", value: 2 },
        { name: "LOOP 3", value: 3 },
        { name: "LOOP 4", value: 4 }
    ];

    drumLoops.forEach((loop, index) => {
        const button = document.createElement("button");
        button.textContent = loop.name;
        button.className = "loop-button";
        button.dataset.loopValue = loop.value;

        if (index === 0) {
            button.classList.add("active");
        }

        const handleLoopSelect = async () => {
            try {
                console.log(`Loop ${loop.value} button pressed, context state:`, context.state);
                await context.resume();
                console.log("Context resumed, new state:", context.state);

                // Start the transport
                device.node.context.transport.running = true;
                console.log("Transport running set to:", device.node.context.transport.running);

                loopSelectParam.value = loop.value;
                console.log("Loop select parameter set to:", loop.value);
                console.log("Current loop_select parameter value:", loopSelectParam.value);

                document.querySelectorAll(".loop-button").forEach(btn => {
                    btn.classList.remove("active");
                });
                button.classList.add("active");

                if (window.updateLastLoopValue) {
                    window.updateLastLoopValue(loop.value);
                }

                const playButton = document.getElementById("play-button");
                const stopButton = document.getElementById("stop-button");
                if (playButton && stopButton) {
                    playButton.classList.add("active");
                    stopButton.classList.remove("active");
                }
            } catch (err) {
                console.error("Error in handleLoopSelect:", err);
            }
        };

        button.addEventListener("click", handleLoopSelect);
        button.addEventListener("touchstart", handleLoopSelect);

        loopDiv.appendChild(button);
    });
}

function makeCustomSliders(device) {
    let pdiv = document.getElementById("rnbo-parameter-sliders");
    let noParamLabel = document.getElementById("no-param-label");
    if (noParamLabel && device.numParameters > 0) pdiv.removeChild(noParamLabel);

    let isDraggingSlider = false;
    let uiElements = {};

    const parametersToShow = ["cut_off", "res", "verb_send"];

    device.parameters.forEach(param => {
        if (!parametersToShow.includes(param.id)) return;

        let label = document.createElement("label");
        let slider = document.createElement("input");
        let text = document.createElement("input");
        let sliderContainer = document.createElement("div");
        sliderContainer.appendChild(label);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(text);

        const displayNames = {
            "cut_off": "CUTOFF",
            "res": "RESONANCE",
            "verb_send": "REVERB"
        };

        label.setAttribute("name", param.name);
        label.setAttribute("for", param.name);
        label.setAttribute("class", "param-label");
        label.textContent = `${displayNames[param.id] || param.name}: `;

        slider.setAttribute("type", "range");
        slider.setAttribute("class", "param-slider");
        slider.setAttribute("id", param.id);
        slider.setAttribute("name", param.name);
        slider.setAttribute("min", param.min);
        slider.setAttribute("max", param.max);
        if (param.steps > 1) {
            slider.setAttribute("step", (param.max - param.min) / (param.steps - 1));
        } else {
            slider.setAttribute("step", (param.max - param.min) / 1000.0);
        }
        slider.setAttribute("value", param.value);

        text.setAttribute("value", param.value.toFixed(1));
        text.setAttribute("type", "text");

        slider.addEventListener("pointerdown", () => {
            isDraggingSlider = true;
        });
        slider.addEventListener("pointerup", () => {
            isDraggingSlider = false;
            slider.value = param.value;
            text.value = param.value.toFixed(1);
        });
        slider.addEventListener("input", () => {
            let value = Number.parseFloat(slider.value);
            param.value = value;
        });

        text.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                let newValue = Number.parseFloat(text.value);
                if (isNaN(newValue)) {
                    text.value = param.value;
                } else {
                    newValue = Math.min(newValue, param.max);
                    newValue = Math.max(newValue, param.min);
                    text.value = newValue;
                    param.value = newValue;
                }
            }
        });

        uiElements[param.id] = { slider, text };
        pdiv.appendChild(sliderContainer);
    });

    device.parameterChangeEvent.subscribe(param => {
        if (!uiElements[param.id]) return;
        if (!isDraggingSlider)
            uiElements[param.id].slider.value = param.value;
        uiElements[param.id].text.value = param.value.toFixed(1);
    });
}

function makeSliders(device) {
    let pdiv = document.getElementById("rnbo-parameter-sliders");
    let noParamLabel = document.getElementById("no-param-label");
    if (noParamLabel && device.numParameters > 0) pdiv.removeChild(noParamLabel);

    // This will allow us to ignore parameter update events while dragging the slider.
    let isDraggingSlider = false;
    let uiElements = {};

    device.parameters.forEach(param => {
        // Subpatchers also have params. If we want to expose top-level
        // params only, the best way to determine if a parameter is top level
        // or not is to exclude parameters with a '/' in them.
        // You can uncomment the following line if you don't want to include subpatcher params
        
        //if (param.id.includes("/")) return;

        // Create a label, an input slider and a value display
        let label = document.createElement("label");
        let slider = document.createElement("input");
        let text = document.createElement("input");
        let sliderContainer = document.createElement("div");
        sliderContainer.appendChild(label);
        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(text);

        // Add a name for the label
        label.setAttribute("name", param.name);
        label.setAttribute("for", param.name);
        label.setAttribute("class", "param-label");
        label.textContent = `${param.name}: `;

        // Make each slider reflect its parameter
        slider.setAttribute("type", "range");
        slider.setAttribute("class", "param-slider");
        slider.setAttribute("id", param.id);
        slider.setAttribute("name", param.name);
        slider.setAttribute("min", param.min);
        slider.setAttribute("max", param.max);
        if (param.steps > 1) {
            slider.setAttribute("step", (param.max - param.min) / (param.steps - 1));
        } else {
            slider.setAttribute("step", (param.max - param.min) / 1000.0);
        }
        slider.setAttribute("value", param.value);

        // Make a settable text input display for the value
        text.setAttribute("value", param.value.toFixed(1));
        text.setAttribute("type", "text");

        // Make each slider control its parameter
        slider.addEventListener("pointerdown", () => {
            isDraggingSlider = true;
        });
        slider.addEventListener("pointerup", () => {
            isDraggingSlider = false;
            slider.value = param.value;
            text.value = param.value.toFixed(1);
        });
        slider.addEventListener("input", () => {
            let value = Number.parseFloat(slider.value);
            param.value = value;
        });

        // Make the text box input control the parameter value as well
        text.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") {
                let newValue = Number.parseFloat(text.value);
                if (isNaN(newValue)) {
                    text.value = param.value;
                } else {
                    newValue = Math.min(newValue, param.max);
                    newValue = Math.max(newValue, param.min);
                    text.value = newValue;
                    param.value = newValue;
                }
            }
        });

        // Store the slider and text by name so we can access them later
        uiElements[param.id] = { slider, text };

        // Add the slider element
        pdiv.appendChild(sliderContainer);
    });

    // Listen to parameter changes from the device
    device.parameterChangeEvent.subscribe(param => {
        if (!isDraggingSlider)
            uiElements[param.id].slider.value = param.value;
        uiElements[param.id].text.value = param.value.toFixed(1);
    });
}

function makeInportForm(device) {
    const idiv = document.getElementById("rnbo-inports");
    const inportSelect = document.getElementById("inport-select");
    const inportText = document.getElementById("inport-text");
    const inportForm = document.getElementById("inport-form");
    let inportTag = null;
    
    // Device messages correspond to inlets/outlets or inports/outports
    // You can filter for one or the other using the "type" of the message
    const messages = device.messages;
    const inports = messages.filter(message => message.type === RNBO.MessagePortType.Inport);

    if (inports.length === 0) {
        idiv.removeChild(document.getElementById("inport-form"));
        return;
    } else {
        idiv.removeChild(document.getElementById("no-inports-label"));
        inports.forEach(inport => {
            const option = document.createElement("option");
            option.innerText = inport.tag;
            inportSelect.appendChild(option);
        });
        inportSelect.onchange = () => inportTag = inportSelect.value;
        inportTag = inportSelect.value;

        inportForm.onsubmit = (ev) => {
            // Do this or else the page will reload
            ev.preventDefault();

            // Turn the text into a list of numbers (RNBO messages must be numbers, not text)
            const values = inportText.value.split(/\s+/).map(s => parseFloat(s));
            
            // Send the message event to the RNBO device
            let messageEvent = new RNBO.MessageEvent(RNBO.TimeNow, inportTag, values);
            device.scheduleEvent(messageEvent);
        }
    }
}

function attachOutports(device) {
    const outports = device.outports;
    if (outports.length < 1) {
        document.getElementById("rnbo-console").removeChild(document.getElementById("rnbo-console-div"));
        return;
    }

    document.getElementById("rnbo-console").removeChild(document.getElementById("no-outports-label"));
    device.messageEvent.subscribe((ev) => {

        // Ignore message events that don't belong to an outport
        if (outports.findIndex(elt => elt.tag === ev.tag) < 0) return;

        // Message events have a tag as well as a payload
        console.log(`${ev.tag}: ${ev.payload}`);

        document.getElementById("rnbo-console-readout").innerText = `${ev.tag}: ${ev.payload}`;
    });
}

function loadPresets(device, patcher) {
    let presets = patcher.presets || [];
    if (presets.length < 1) {
        document.getElementById("rnbo-presets").removeChild(document.getElementById("preset-select"));
        return;
    }

    document.getElementById("rnbo-presets").removeChild(document.getElementById("no-presets-label"));
    let presetSelect = document.getElementById("preset-select");
    presets.forEach((preset, index) => {
        const option = document.createElement("option");
        option.innerText = preset.name;
        option.value = index;
        presetSelect.appendChild(option);
    });
    presetSelect.onchange = () => device.setPreset(presets[presetSelect.value].preset);
}

function connectUSBMIDI(device) {
    if (navigator.requestMIDIAccess) {
        navigator.requestMIDIAccess()
            .then(midiAccess => {
                console.log("MIDI Access granted");

                const inputs = midiAccess.inputs;
                let midiInputCount = 0;

                inputs.forEach(input => {
                    midiInputCount++;
                    console.log(`MIDI Input: ${input.name}`);

                    input.onmidimessage = (message) => {
                        const data = message.data;
                        const midiPort = 0;

                        const midiEvent = new RNBO.MIDIEvent(
                            device.context.currentTime * 1000,
                            midiPort,
                            data
                        );

                        device.scheduleEvent(midiEvent);
                    };
                });

                if (midiInputCount > 0) {
                    console.log(`Connected ${midiInputCount} MIDI input device(s)`);
                } else {
                    console.log("No MIDI input devices found. Connect a USB MIDI device.");
                }

                midiAccess.onstatechange = (event) => {
                    console.log(`MIDI State Change: ${event.port.name} - ${event.port.state}`);
                    if (event.port.state === 'connected' && event.port.type === 'input') {
                        event.port.onmidimessage = (message) => {
                            const data = message.data;
                            const midiPort = 0;

                            const midiEvent = new RNBO.MIDIEvent(
                                device.context.currentTime * 1000,
                                midiPort,
                                data
                            );

                            device.scheduleEvent(midiEvent);
                        };
                    }
                };
            })
            .catch(err => {
                console.error("MIDI Access denied or not supported:", err);
            });
    } else {
        console.warn("Web MIDI API not supported in this browser");
    }
}

setup();
