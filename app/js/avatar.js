// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Avatar Module
// Three.js loaded via global bundle (THREE.*)
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const MODELS = {
        kelion: '/models/k-male.glb',
        kira: '/models/k-female.glb'
    };

    let scene, camera, renderer, clock;
    let currentModel = null;
    let morphMeshes = [];
    let mixer = null;
    let lipSync = null;
    let textLipSync = null;
    let currentAvatar = 'kelion';
    let loadPromise = null;

    // Blink
    let blinkTimer = 0, nextBlink = 2 + Math.random() * 4, blinkPhase = 0, blinkValue = 0;

    // Expression
    let targetExpression = {}, currentExpression = {};
    let currentExpressionName = 'neutral';

    // Attention state — stops idle when listening
    let isAttentive = false;

    // Presenting state — rotates 8° towards monitor
    let isPresenting = false;
    var PRESENT_ANGLE = 8 * Math.PI / 180; // 8 degrees right

    function init() {
        const canvas = document.getElementById('avatar-canvas');
        if (!canvas || !window.THREE) {
            console.error('[Avatar] THREE.js not loaded');
            return;
        }

        scene = new THREE.Scene();
        clock = new THREE.Clock();

        const container = canvas.parentElement;
        const w = container.clientWidth;
        const h = container.clientHeight;

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
        camera.position.set(0, 0.1, 1.8);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        // Premium studio lighting
        scene.add(new THREE.AmbientLight(0x404060, 0.6));

        const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
        keyLight.position.set(2, 3, 4);
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.5);
        fillLight.position.set(-2, 1, 2);
        scene.add(fillLight);

        const rimLight = new THREE.DirectionalLight(0x00ccff, 0.8);
        rimLight.position.set(0, 2, -3);
        scene.add(rimLight);

        const bottomLight = new THREE.DirectionalLight(0x8855ff, 0.3);
        bottomLight.position.set(0, -2, 1);
        scene.add(bottomLight);

        scene.background = new THREE.Color(0x060614);

        // Lip sync — simple, uses Smile morph
        if (window.SimpleLipSync) lipSync = new SimpleLipSync();
        if (window.TextLipSync) textLipSync = new TextLipSync({ msPerChar: 55 });

        loadAvatar('kelion');
        window.addEventListener('resize', onResize);
        animate();
        console.log('[Avatar] Initialized');
    }

    function loadAvatar(name) {
        if (!MODELS[name]) return Promise.resolve();
        currentAvatar = name;

        if (currentModel) { scene.remove(currentModel); currentModel = null; }
        morphMeshes = [];

        loadPromise = new Promise(function (resolve, reject) {
        const loader = new THREE.GLTFLoader();
        loader.load(MODELS[name], (gltf) => {
            currentModel = gltf.scene;

            const box = new THREE.Box3().setFromObject(currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            currentModel.position.sub(center);
            const maxDim = Math.max(size.x, size.y, size.z);
            if (maxDim > 0) currentModel.scale.setScalar(0.5 / maxDim);

            currentModel.traverse((child) => {
                if (child.isMesh) {
                    child.visible = true;
                    child.frustumCulled = false;
                    if (child.material) child.material.needsUpdate = true;

                    // Morph targets — traverse ALL meshes regardless of name
                    if (child.isMesh && child.morphTargetDictionary) {
                        morphMeshes.push(child);
                        child.morphTargetInfluences.fill(0);
                        console.log('[Avatar] Morph:', child.name, Object.keys(child.morphTargetDictionary).join(', '));
                    }

                    // Z-fighting fix for eyebrows/lashes (from v1)
                    var nm = (child.name || '').toLowerCase();
                    var matNm = (child.material && child.material.name) ? child.material.name.toLowerCase() : '';
                    var isHead = (nm.indexOf('head') !== -1 && nm.indexOf('eye') === -1) || matNm === 'head';
                    var isBrow = nm.indexOf('brow') !== -1 || matNm.indexOf('brow') !== -1;
                    var isLash = nm.indexOf('lash') !== -1 || matNm.indexOf('lash') !== -1;

                    if (isHead && child.material) {
                        child.renderOrder = 0;
                        child.material.polygonOffset = true;
                        child.material.polygonOffsetFactor = 4;
                        child.material.polygonOffsetUnits = 4;
                    }
                    if ((isBrow || isLash) && child.material) {
                        child.renderOrder = 2;
                        child.material.side = THREE.DoubleSide;
                        child.material.depthTest = false;
                        child.material.depthWrite = false;
                        child.material.transparent = true;
                        child.material.opacity = 1.0;
                    }
                }
            });

            // MIRROR FIX for k-female.glb — Blender mirror modifier not applied
            // Brows and lashes only have geometry on one side, clone + flip X
            if (name === 'kira') {
                var meshesToMirror = [];
                currentModel.traverse(function (child) {
                    if (!child.isMesh) return;
                    var nmLow = (child.name || '').toLowerCase();
                    if (nmLow.indexOf('brow') !== -1 || nmLow.indexOf('lash') !== -1) {
                        meshesToMirror.push(child);
                    }
                });
                meshesToMirror.forEach(function (origMesh) {
                    var mirrorGeo = origMesh.geometry.clone();
                    var pos = mirrorGeo.attributes.position;
                    var nrm = mirrorGeo.attributes.normal;
                    for (var vi = 0; vi < pos.count; vi++) {
                        pos.setX(vi, -pos.getX(vi));
                        if (nrm) nrm.setX(vi, -nrm.getX(vi));
                    }
                    pos.needsUpdate = true;
                    if (nrm) nrm.needsUpdate = true;
                    var idx = mirrorGeo.index;
                    if (idx) {
                        var arr = idx.array;
                        for (var ti = 0; ti < arr.length; ti += 3) {
                            var tmp = arr[ti]; arr[ti] = arr[ti + 2]; arr[ti + 2] = tmp;
                        }
                        idx.needsUpdate = true;
                    }
                    var mirrorMat = origMesh.material.clone();
                    mirrorMat.side = THREE.DoubleSide;
                    mirrorMat.depthTest = false;
                    mirrorMat.depthWrite = false;
                    mirrorMat.transparent = true;
                    mirrorMat.opacity = 1.0;
                    var mirrorMesh;
                    if (origMesh.isSkinnedMesh && origMesh.skeleton) {
                        mirrorMesh = new THREE.SkinnedMesh(mirrorGeo, mirrorMat);
                        mirrorMesh.bind(origMesh.skeleton, origMesh.bindMatrix);
                    } else {
                        mirrorMesh = new THREE.Mesh(mirrorGeo, mirrorMat);
                    }
                    mirrorMesh.renderOrder = 2;
                    mirrorMesh.name = origMesh.name + '_mirror';
                    mirrorMesh.frustumCulled = false;
                    mirrorMesh.position.copy(origMesh.position);
                    mirrorMesh.rotation.copy(origMesh.rotation);
                    mirrorMesh.scale.copy(origMesh.scale);
                    origMesh.parent.add(mirrorMesh);
                });
                console.log('[Avatar] Kira mirror fix applied to', meshesToMirror.length, 'meshes');
            }

            scene.add(currentModel);

            if (lipSync) lipSync.setMorphMeshes(morphMeshes);
            if (textLipSync) textLipSync.setMorphMeshes(morphMeshes);

            if (gltf.animations && gltf.animations.length) {
                mixer = new THREE.AnimationMixer(currentModel);
                gltf.animations.forEach(clip => mixer.clipAction(clip).play());
            }

            document.getElementById('avatar-name').textContent = name === 'kira' ? 'Kira' : 'Kelion';
            document.getElementById('status-text').textContent = 'Online';
            console.log(`[Avatar] ${name} loaded — ${morphMeshes.length} morph meshes`);
            resolve(name);
        }, (progress) => {
            if (progress.total) {
                const pct = Math.round((progress.loaded / progress.total) * 100);
                document.getElementById('status-text').textContent = `Se încarcă... ${pct}%`;
            }
        }, (err) => {
            console.error(`[Avatar] Load error:`, err);
            document.getElementById('status-text').textContent = 'Eroare model';
            reject(err);
        });
        });

        return loadPromise;
    }

    function setMorph(name, value) {
        for (const mesh of morphMeshes) {
            const idx = mesh.morphTargetDictionary[name];
            if (idx !== undefined) mesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, value));
        }
    }

    function updateBlink(dt) {
        blinkTimer += dt;
        if (blinkPhase === 0 && blinkTimer >= nextBlink) { blinkPhase = 1; blinkTimer = 0; }
        if (blinkPhase === 1) { blinkValue = Math.min(1, blinkValue + dt * 12); if (blinkValue >= 1) blinkPhase = 2; }
        if (blinkPhase === 2) {
            blinkValue = Math.max(0, blinkValue - dt * 8);
            if (blinkValue <= 0) {
                blinkPhase = 0; blinkValue = 0;
                nextBlink = Math.random() < 0.15 ? 0.2 : (2 + Math.random() * 4);
                blinkTimer = 0;
            }
        }
        setMorph('eyeBlinkLeft', blinkValue);
        setMorph('eyeBlinkRight', blinkValue);
        setMorph('eyeBlink_L', blinkValue);
        setMorph('eyeBlink_R', blinkValue);
        setMorph('EyeBlink', blinkValue);
    }

    function setExpression(name, intensity) {
        intensity = intensity || 0.5;
        var expressions = {
            happy: { 'cheekSquintLeft': 0.3, 'cheekSquintRight': 0.3, 'mouthSmileLeft': 0.2, 'mouthSmileRight': 0.2 },
            thinking: { 'browInnerUp': 0.3, 'eyeSquintLeft': 0.15, 'eyeSquintRight': 0.15 },
            concerned: { 'browInnerUp': 0.4, 'mouthFrownLeft': 0.2, 'mouthFrownRight': 0.2 },
            neutral: {},
            laughing: { 'mouthSmileLeft': 0.7, 'mouthSmileRight': 0.7, 'cheekSquintLeft': 0.6, 'cheekSquintRight': 0.6, 'eyeSquintLeft': 0.4, 'eyeSquintRight': 0.4 },
            surprised: { 'browInnerUp': 0.8, 'browOuterUpLeft': 0.5, 'browOuterUpRight': 0.5, 'mouthOpen': 0.3 },
            playful: { 'eyeSquintLeft': 0.3, 'mouthSmileLeft': 0.4, 'mouthSmileRight': 0.1, 'browOuterUpRight': 0.3 },
            sad: { 'browInnerUp': 0.5, 'mouthFrownLeft': 0.4, 'mouthFrownRight': 0.4, 'eyeSquintLeft': 0.2, 'eyeSquintRight': 0.2 },
            determined: { 'browDownLeft': 0.3, 'browDownRight': 0.3, 'jawForward': 0.1, 'mouthPressLeft': 0.2, 'mouthPressRight': 0.2 },
            loving: { 'cheekSquintLeft': 0.4, 'cheekSquintRight': 0.4, 'mouthSmileLeft': 0.3, 'mouthSmileRight': 0.3, 'eyeSquintLeft': 0.15, 'eyeSquintRight': 0.15 },
            sleepy: { 'eyeBlinkLeft': 0.4, 'eyeBlinkRight': 0.4, 'browInnerUp': 0.1, 'mouthOpen': 0.05 }
        };
        currentExpressionName = name;
        targetExpression = {};
        var expr = expressions[name] || {};
        for (var key in expr) targetExpression[key] = expr[key] * intensity;
        setMoodLighting(name);
    }

    // Mood lighting target
    var targetBgColor = new THREE.Color(0x060614);

    function setMoodLighting(mood) {
        if (!scene) return;
        var colors = {
            happy: 0x0a0a1e,
            laughing: 0x0e0a1e,
            sad: 0x060618,
            concerned: 0x0a0814,
            thinking: 0x060614,
            surprised: 0x0e0e1e,
            playful: 0x0c0a1e,
            loving: 0x100a18,
            determined: 0x08080e,
            neutral: 0x060614
        };
        targetBgColor.set(colors[mood] || colors.neutral);
    }

    function updateMoodLighting() {
        if (!scene || !scene.background) return;
        scene.background.lerp(targetBgColor, 0.05);
    }

    // ── Gesture system ───────────────────────────────────────
    var gestureQueue = [];
    var gestureActive = false;
    var gestureTimer = 0;
    var gestureDuration = 0;
    var gestureData = null;

    function playGesture(type) {
        gestureQueue.push(type);
    }

    function updateGesture(dt) {
        if (!currentModel) return;
        if (gestureActive) {
            gestureTimer += dt;
            var t = gestureTimer / gestureDuration;
            if (t >= 1) {
                gestureActive = false;
                gestureTimer = 0;
                gestureData = null;
                currentModel.rotation.z += (-currentModel.rotation.z) * 0.1;
                return;
            }
            var angle = Math.sin(t * Math.PI);
            if (gestureData === 'nod') {
                currentModel.rotation.x += (angle * 0.15 - currentModel.rotation.x) * 0.2;
            } else if (gestureData === 'shake') {
                currentModel.rotation.y += (Math.sin(t * Math.PI * 3) * 0.12 - currentModel.rotation.y) * 0.2;
            } else if (gestureData === 'tilt') {
                currentModel.rotation.z += (angle * 0.1 - currentModel.rotation.z) * 0.15;
            } else if (gestureData === 'lookAway') {
                currentModel.rotation.y += (Math.sin(t * Math.PI) * 0.2 - currentModel.rotation.y) * 0.15;
            }
        } else if (gestureQueue.length > 0) {
            gestureData = gestureQueue.shift();
            gestureActive = true;
            gestureTimer = 0;
            gestureDuration = gestureData === 'shake' ? 1.0 : 0.6;
        }
    }

    function updateExpression(dt) {
        var speed = 3 * dt;
        var allKeys = {};
        var k;
        for (k in targetExpression) allKeys[k] = true;
        for (k in currentExpression) allKeys[k] = true;
        for (k in allKeys) {
            var target = targetExpression[k] || 0;
            var current = currentExpression[k] || 0;
            var next = current + (target - current) * speed;
            if (Math.abs(next) < 0.001 && target === 0) delete currentExpression[k];
            else { currentExpression[k] = next; setMorph(k, next); }
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        var dt = clock.getDelta();
        if (mixer) mixer.update(dt);
        updateBlink(dt);
        updateExpression(dt);
        if (lipSync) lipSync.update();
        updateGesture(dt);
        updateMoodLighting();
        if (currentModel) {
            var targetY = 0;
            var targetX = 0;

            if (isPresenting) {
                // Look towards monitor (right side)
                targetY = -PRESENT_ANGLE;
            } else if (isAttentive) {
                // Look straight at user
                targetY = 0;
                targetX = 0;
            } else {
                // Subtle idle sway
                var t = clock.elapsedTime;
                targetY = Math.sin(t * 0.3) * 0.02;
                targetX = Math.sin(t * 0.2) * 0.01;
            }

            currentModel.rotation.y += (targetY - currentModel.rotation.y) * 0.08;
            currentModel.rotation.x += (targetX - currentModel.rotation.x) * 0.08;
        }
        renderer.render(scene, camera);
    }

    function onResize() {
        var canvas = document.getElementById('avatar-canvas');
        if (!canvas) return;
        var container = canvas.parentElement;
        var w = container.clientWidth;
        var h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    window.KAvatar = {
        init: init,
        loadAvatar: function (name) { return loadAvatar(name); },
        loadAvatarAsync: loadAvatar,
        waitForLoad: function () { return loadPromise || Promise.resolve(); },
        getCurrentAvatar: function () { return currentAvatar; },
        getCurrentExpression: function () { return currentExpressionName; },
        setExpression: setExpression,
        setMoodLighting: setMoodLighting,
        playGesture: playGesture,
        setMorph: setMorph,
        setAttentive: function (v) { isAttentive = v; },
        setPresenting: function (v) { isPresenting = v; },
        getLipSync: function () { return lipSync; },
        getTextLipSync: function () { return textLipSync; },
        getMorphMeshes: function () { return morphMeshes; }
    };
})();
