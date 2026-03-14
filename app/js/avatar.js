// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Avatar Module
// Three.js loaded via global bundle (THREE.*)
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const CACHE_BUST = Date.now();
    const MODELS = {
        kelion: '/models/k-male.glb?v=' + CACHE_BUST,
        kira: '/models/k-female.glb?v=' + CACHE_BUST
    };

    let scene, camera, renderer, clock;
    let currentModel = null;
    let morphMeshes = [];
    let mixer = null;
    let lipSync = null;
    let textLipSync = null;
    let currentAvatar = 'kelion';
    let loadPromise = null;
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 50; // up to 5s total

    // Per-avatar background textures (IIFE scope — accessible from init + loadAvatar)
    const bgTextures = { kelion: '/models/avatar-bg.png', kira: '/models/avatar-bg-kira.png' };
    let bgLoader = null;
    function _loadAvatarBg(name) {
        // Background texture DISABLED — solid dark color for clean avatar view
        if (scene) scene.background = new THREE.Color(0x060614);
    }

    // Blink
    let blinkTimer = 0, nextBlink = 2 + Math.random() * 4, blinkPhase = 0, blinkValue = 0;

    // Expression
    let targetExpression = {};
    const currentExpression = {};
    let currentExpressionName = 'neutral';

    // Mouth morph cache — populated at loadAvatar, used in animate for force-close
    let _mouthMorphCache = [];
    function _cacheMouthMorphs() {
        _mouthMorphCache = [];
        morphMeshes.forEach(function (m) {
            if (!m.morphTargetDictionary || !m.morphTargetInfluences) return;
            Object.keys(m.morphTargetDictionary).forEach(function (k) {
                const kl = k.toLowerCase();
                if (kl.indexOf('mouth') >= 0 || kl.indexOf('jaw') >= 0 || kl.indexOf('viseme') >= 0 || kl.indexOf('lip') >= 0 || kl === 'smile') {
                    _mouthMorphCache.push({ mesh: m, idx: m.morphTargetDictionary[k] });
                }
            });
        });
        console.log('[Avatar] Mouth morph cache:', _mouthMorphCache.length, 'targets');
    }

    // Attention state — stops idle when listening
    let isAttentive = false;

    // Presenting state — rotates 8° towards monitor
    let isPresenting = false;
    const PRESENT_ANGLE = 8 * Math.PI / 180; // 8 degrees right

    // ══ INNOVATIVE: Eye Tracking (mouse follow + face tracking) ══════════════
    let _mouseX = 0, _mouseY = 0;
    let _eyeBones = { left: null, right: null };
    let _headBone = null;
    let _spineBone = null;
    let _neckBone = null;
    const _fingerBones = { left: {}, right: {} };
    document.addEventListener('mousemove', function (e) {
        if (_faceTrackingActive) return; // Camera overrides mouse
        _mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        _mouseY = -((e.clientY / window.innerHeight) * 2 - 1);
    });

    // ══ Face Tracking via Camera ═══════════════════════════════
    let _faceTrackingActive = false;
    let _faceTrackingTimeout = null;

    // Listen for vision-detection events (from RealtimeVision COCO-SSD)
    window.addEventListener('vision-detection', function (e) {
        if (!e.detail || !e.detail.predictions) return;
        const preds = e.detail.predictions;
        let person = null;
        for (let i = 0; i < preds.length; i++) {
            if (preds[i].class === 'person' && preds[i].score > 0.4) {
                person = preds[i];
                break;
            }
        }
        if (person) {
            _faceTrackingActive = true;
            const video = document.querySelector('video');
            const vw = video ? video.videoWidth || 640 : 640;
            const vh = video ? video.videoHeight || 480 : 480;
            const faceCenterX = person.bbox[0] + person.bbox[2] / 2;
            const faceCenterY = person.bbox[1] + person.bbox[3] * 0.2;
            _mouseX = -((faceCenterX / vw) * 2 - 1);
            _mouseY = -((faceCenterY / vh) * 2 - 1);
            // Auto-expire face tracking if no new detection for 3s
            clearTimeout(_faceTrackingTimeout);
            _faceTrackingTimeout = setTimeout(function () { _faceTrackingActive = false; }, 3000);
        }
    });

    // Listen for face-position events (from KAutoCamera lightweight face detection)
    window.addEventListener('face-position', function (e) {
        if (!e.detail) return;
        _faceTrackingActive = true;
        // e.detail.x, e.detail.y are normalized -1..1 (already mirrored)
        _mouseX = e.detail.x;
        _mouseY = e.detail.y;
        clearTimeout(_faceTrackingTimeout);
        _faceTrackingTimeout = setTimeout(function () { _faceTrackingActive = false; }, 3000);
    });

    // ══ INNOVATIVE: Micro-expressions ═════════════════════════
    let _microTimer = 0;
    let _nextMicro = 3 + Math.random() * 5; // 3-8s between twitches
    let _microActive = false;
    let _microMorph = '';
    let _microValue = 0;
    let _microDuration = 0;
    let _microElapsed = 0;
    const MICRO_EXPRESSIONS = [
        { morph: 'browInnerUp', max: 0.15, duration: 0.3 },
        { morph: 'browOuterUpLeft', max: 0.12, duration: 0.25 },
        { morph: 'browOuterUpRight', max: 0.12, duration: 0.25 },
        { morph: 'cheekSquintLeft', max: 0.1, duration: 0.2 },
        { morph: 'cheekSquintRight', max: 0.1, duration: 0.2 },
        { morph: 'cheekPuff', max: 0.06, duration: 0.3 },
        { morph: 'noseSneerLeft', max: 0.08, duration: 0.15 },
        { morph: 'noseSneerRight', max: 0.08, duration: 0.15 },
        { morph: 'mouthPressLeft', max: 0.06, duration: 0.2 },
        { morph: 'mouthSmileLeft', max: 0.08, duration: 0.3 },
        { morph: 'mouthDimpleLeft', max: 0.05, duration: 0.2 },
        { morph: 'mouthDimpleRight', max: 0.05, duration: 0.2 },
        { morph: 'mouthShrugLower', max: 0.06, duration: 0.25 },
        { morph: 'eyeSquintLeft', max: 0.1, duration: 0.2 },
        { morph: 'eyeSquintRight', max: 0.1, duration: 0.2 }
    ];

    // ══ INNOVATIVE: Eye Saccades ══════════════════════════════
    let _saccadeTimer = 0;
    let _nextSaccade = 0.5 + Math.random() * 2; // 0.5-2.5s
    let _saccadeTargetX = 0, _saccadeTargetY = 0;
    let _saccadeCurrentX = 0, _saccadeCurrentY = 0;

    // ══ INNOVATIVE: Breathing ═════════════════════════════════
    let _breathPhase = 0;
    const BREATH_SPEED = 0.8; // ~4s per full cycle
    const BREATH_AMOUNT = 0.015; // Visible chest movement

    // Expression intensity table (smarter than fixed 0.5)
    const EXPRESSION_INTENSITY = {
        happy: 0.5, thinking: 0.35, concerned: 0.4, neutral: 0,
        laughing: 0.7, surprised: 0.6, playful: 0.5,
        sad: 0.45, determined: 0.4, loving: 0.5, sleepy: 0.3,
        disgusted: 0.5, angry: 0.5, curious: 0.35
    };

    function init() {
        const canvas = document.getElementById('avatar-canvas');
        if (!canvas || !window.THREE) {
            console.error('[Avatar] THREE.js not loaded');
            return;
        }

        const container = canvas.parentElement;
        const w = container.clientWidth;
        const h = container.clientHeight;

        // If container has no size yet (hidden/transitioning), wait and retry
        if (w === 0 || h === 0) {
            if (initRetryCount < MAX_INIT_RETRIES) {
                initRetryCount++;
                console.warn('[Avatar] Container has 0 size, retrying in 100ms... (' + initRetryCount + '/' + MAX_INIT_RETRIES + ')');
                setTimeout(init, 100);
            } else {
                console.error('[Avatar] Container never got a size after 5s — init aborted');
            }
            return;
        }
        initRetryCount = 0; // Reached only when w>0 && h>0 — reset counter for next potential call

        scene = new THREE.Scene();
        clock = new THREE.Clock();

        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3)); // CINEMATIC: up to 3x for 4K/retina

        camera = new THREE.PerspectiveCamera(24, w / h, 0.1, 100);
        camera.position.set(0, 0.45, 1.90); // Centered bust — safe zoom for FOV 24°
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

        // Init texture loader and load initial background
        bgLoader = new THREE.TextureLoader();
        _loadAvatarBg('kelion');

        // Lip sync — simple, uses Smile morph
        if (window.SimpleLipSync) lipSync = new SimpleLipSync();
        if (window.TextLipSync) textLipSync = new TextLipSync({ msPerChar: 38 });

        loadAvatar('kelion').then(function () {
            console.log('[Avatar] Kelion loaded');
            // Preload Kira model silently into browser cache
            const preloader = new THREE.GLTFLoader();
            preloader.load(MODELS.kira, function () {
                console.log('[Avatar] Kira model preloaded into cache');
                console.log('[Avatar] ✅ Both avatars ready!');
                window.dispatchEvent(new CustomEvent('avatars-ready'));
            }, null, function () {
                // Even if Kira fails, still signal ready
                window.dispatchEvent(new CustomEvent('avatars-ready'));
            });
        }).catch(function () {
            // Even if Kelion fails, signal ready after timeout
            setTimeout(function () { window.dispatchEvent(new CustomEvent('avatars-ready')); }, 3000);
        });
        window.addEventListener('resize', onResize);
        animate();
        console.log('[Avatar] Initialized');
    }

    function loadAvatar(name) {
        if (!MODELS[name]) return Promise.resolve();
        currentAvatar = name;
        if (_loadAvatarBg) _loadAvatarBg(name); // Switch background per avatar

        if (currentModel) { scene.remove(currentModel); currentModel = null; }
        morphMeshes = [];

        loadPromise = new Promise(function (resolve, reject) {
            const loader = new THREE.GLTFLoader();
            loader.load(MODELS[name], (gltf) => {
                currentModel = gltf.scene;

                const box = new THREE.Box3().setFromObject(currentModel);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());

                // Center model at world origin
                currentModel.position.sub(center);
                const maxDim = Math.max(size.x, size.y, size.z);
                if (maxDim > 0) currentModel.scale.setScalar(1.2 / maxDim);

                // Shift model down for head+torso framing
                currentModel.position.y -= 0.08; // Head+shoulders centered, not too low

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
                        // After last mesh, rebuild mouth cache
                        _cacheMouthMorphs();

                        // Z-fighting fix for eyebrows/lashes (from v1)
                        const nm = (child.name || '').toLowerCase();
                        const matNm = (child.material && child.material.name) ? child.material.name.toLowerCase() : '';
                        const isHead = (nm.indexOf('head') !== -1 && nm.indexOf('eye') === -1) || matNm === 'head';
                        const isBrow = nm.indexOf('brow') !== -1 || matNm.indexOf('brow') !== -1;
                        const isLash = nm.indexOf('lash') !== -1 || matNm.indexOf('lash') !== -1;

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
                    const meshesToMirror = [];
                    currentModel.traverse(function (child) {
                        if (!child.isMesh) return;
                        const nmLow = (child.name || '').toLowerCase();
                        if (nmLow.indexOf('brow') !== -1 || nmLow.indexOf('lash') !== -1) {
                            meshesToMirror.push(child);
                        }
                    });
                    meshesToMirror.forEach(function (origMesh) {
                        const mirrorGeo = origMesh.geometry.clone();
                        const pos = mirrorGeo.attributes.position;
                        const nrm = mirrorGeo.attributes.normal;
                        for (let vi = 0; vi < pos.count; vi++) {
                            pos.setX(vi, -pos.getX(vi));
                            if (nrm) nrm.setX(vi, -nrm.getX(vi));
                        }
                        pos.needsUpdate = true;
                        if (nrm) nrm.needsUpdate = true;
                        const idx = mirrorGeo.index;
                        if (idx) {
                            const arr = idx.array;
                            for (let ti = 0; ti < arr.length; ti += 3) {
                                const tmp = arr[ti]; arr[ti] = arr[ti + 2]; arr[ti + 2] = tmp;
                            }
                            idx.needsUpdate = true;
                        }
                        const mirrorMat = origMesh.material.clone();
                        mirrorMat.side = THREE.DoubleSide;
                        mirrorMat.depthTest = false;
                        mirrorMat.depthWrite = false;
                        mirrorMat.transparent = true;
                        mirrorMat.opacity = 1.0;
                        let mirrorMesh;
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

                // ARM POSE — find bones and set default relaxed pose
                try { if (typeof findArmBones === 'function') findArmBones(); } catch (e) { console.warn('[Avatar] findArmBones skipped:', e.message); }
                try { if (typeof _findEyeAndSpineBones === 'function') _findEyeAndSpineBones(); } catch (e) { console.warn('[Avatar] _findEyeAndSpineBones skipped:', e.message); }
                try { if (typeof setPose === 'function') setPose('relaxed'); } catch (e) { console.warn('[Avatar] setPose skipped:', e.message); }

                scene.add(currentModel);
                onResize(); // Force canvas resize after model load

                if (lipSync) lipSync.setMorphMeshes(morphMeshes);
                if (textLipSync) textLipSync.setMorphMeshes(morphMeshes);

                if (gltf.animations && gltf.animations.length) {
                    mixer = new THREE.AnimationMixer(currentModel);
                    console.log('[Avatar] 🎬 Animation clips:', gltf.animations.length);
                    gltf.animations.forEach(function (clip, i) {
                        console.log('[Avatar]   Clip ' + i + ': "' + clip.name + '" ' + clip.duration.toFixed(1) + 's, tracks=' + clip.tracks.length);
                        mixer.clipAction(clip).play();
                    });
                } else {
                    console.log('[Avatar] ⚠️ No animation clips in model');
                }

                document.getElementById('avatar-name').textContent = name === 'kira' ? 'Kira' : 'Kelion';
                document.getElementById('status-text').textContent = 'Online';
                console.log(`[Avatar] ${name} loaded — ${morphMeshes.length} morph meshes`);
                renderer.render(scene, camera);
                setTimeout(function () { renderer.render(scene, camera); }, 100);
                resolve(name);
            }, (progress) => {
                if (progress.total) {
                    const pct = Math.round((progress.loaded / progress.total) * 100);
                    document.getElementById('status-text').textContent = `Loading... ${pct}%`;
                }
            }, (err) => {
                console.error(`[Avatar] Load error:`, err);
                document.getElementById('status-text').textContent = 'Model error';
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
        // Smart intensity — use table if no explicit override
        if (intensity === undefined || intensity === null) {
            intensity = EXPRESSION_INTENSITY[name] || 0.5;
        }
        const expressions = {
            happy: { 'cheekSquintLeft': 0.3, 'cheekSquintRight': 0.3, 'mouthSmileLeft': 0.2, 'mouthSmileRight': 0.2, 'mouthDimpleLeft': 0.1, 'mouthDimpleRight': 0.1 },
            thinking: { 'browInnerUp': 0.3, 'eyeSquintLeft': 0.15, 'eyeSquintRight': 0.15, 'cheekPuff': 0.08, 'mouthPressLeft': 0.1, 'mouthPressRight': 0.1 },
            concerned: { 'browInnerUp': 0.4, 'mouthFrownLeft': 0.2, 'mouthFrownRight': 0.2, 'mouthStretchLeft': 0.08, 'mouthStretchRight': 0.08 },
            neutral: {},
            laughing: { 'mouthSmileLeft': 0.7, 'mouthSmileRight': 0.7, 'cheekSquintLeft': 0.6, 'cheekSquintRight': 0.6, 'eyeSquintLeft': 0.4, 'eyeSquintRight': 0.4, 'mouthDimpleLeft': 0.3, 'mouthDimpleRight': 0.3, 'mouthUpperUpLeft': 0.15, 'mouthUpperUpRight': 0.15 },
            surprised: { 'browInnerUp': 0.8, 'browOuterUpLeft': 0.5, 'browOuterUpRight': 0.5, 'mouthOpen': 0.3, 'eyeWideLeft': 0.5, 'eyeWideRight': 0.5, 'jawOpen': 0.15 },
            playful: { 'eyeSquintLeft': 0.3, 'mouthSmileLeft': 0.4, 'mouthSmileRight': 0.1, 'browOuterUpRight': 0.3, 'mouthDimpleLeft': 0.15 },
            sad: { 'browInnerUp': 0.5, 'mouthFrownLeft': 0.4, 'mouthFrownRight': 0.4, 'eyeSquintLeft': 0.2, 'eyeSquintRight': 0.2, 'mouthLowerDownLeft': 0.15, 'mouthLowerDownRight': 0.15, 'mouthStretchLeft': 0.1, 'mouthStretchRight': 0.1 },
            determined: { 'browDownLeft': 0.3, 'browDownRight': 0.3, 'jawForward': 0.1, 'mouthPressLeft': 0.2, 'mouthPressRight': 0.2, 'mouthRollLower': 0.1 },
            loving: { 'cheekSquintLeft': 0.4, 'cheekSquintRight': 0.4, 'mouthSmileLeft': 0.3, 'mouthSmileRight': 0.3, 'eyeSquintLeft': 0.15, 'eyeSquintRight': 0.15, 'mouthDimpleLeft': 0.1, 'mouthDimpleRight': 0.1 },
            sleepy: { 'eyeBlinkLeft': 0.4, 'eyeBlinkRight': 0.4, 'browInnerUp': 0.1, 'mouthOpen': 0.05, 'mouthRollLower': 0.05 },
            disgusted: { 'noseSneerLeft': 0.5, 'noseSneerRight': 0.5, 'mouthUpperUpLeft': 0.4, 'mouthUpperUpRight': 0.4, 'browDownLeft': 0.3, 'browDownRight': 0.3, 'mouthFrownLeft': 0.25, 'mouthFrownRight': 0.25, 'mouthShrugUpper': 0.2 },
            angry: { 'browDownLeft': 0.6, 'browDownRight': 0.6, 'eyeSquintLeft': 0.3, 'eyeSquintRight': 0.3, 'jawForward': 0.15, 'mouthFrownLeft': 0.3, 'mouthFrownRight': 0.3, 'noseSneerLeft': 0.2, 'noseSneerRight': 0.2, 'mouthPressLeft': 0.2, 'mouthPressRight': 0.2 },
            curious: { 'browOuterUpLeft': 0.4, 'browOuterUpRight': 0.2, 'eyeWideLeft': 0.15, 'eyeWideRight': 0.15, 'mouthSmileLeft': 0.1, 'mouthFunnel': 0.08 }
        };
        currentExpressionName = name;
        targetExpression = {};
        const expr = expressions[name] || {};
        for (const key in expr) targetExpression[key] = expr[key] * intensity;
        setMoodLighting(name);
    }

    // Mood lighting target
    const targetBgColor = new THREE.Color(0x060614);

    function setMoodLighting(mood) {
        if (!scene) return;
        const colors = {
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
        // Manual lerp — THREE.Color may not have .lerp() in all versions
        const bg = scene.background;
        bg.r += (targetBgColor.r - bg.r) * 0.05;
        bg.g += (targetBgColor.g - bg.g) * 0.05;
        bg.b += (targetBgColor.b - bg.b) * 0.05;
    }

    // ── Gesture system ───────────────────────────────────────
    const gestureQueue = [];
    let gestureActive = false;
    let gestureTimer = 0;
    let gestureDuration = 0;
    let gestureData = null;

    function playGesture(type) {
        gestureQueue.push(type);
    }

    function updateGesture(dt) {
        if (!currentModel) return;
        if (gestureActive) {
            gestureTimer += dt;
            const t = gestureTimer / gestureDuration;
            if (t >= 1) {
                gestureActive = false;
                gestureTimer = 0;
                gestureData = null;
                currentModel.rotation.z += (-currentModel.rotation.z) * 0.1;
                currentModel.rotation.x += (-currentModel.rotation.x) * 0.1;
                currentModel.rotation.y += (-currentModel.rotation.y) * 0.1;
                return;
            }
            const angle = Math.sin(t * Math.PI);
            // DAMPENED: reduced amplitudes ~60% + slower lerp to avoid bouncy puppet effect
            if (gestureData === 'nod') {
                currentModel.rotation.x += (angle * 0.025 - currentModel.rotation.x) * 0.08;
            } else if (gestureData === 'shake') {
                currentModel.rotation.y += (Math.sin(t * Math.PI * 3) * 0.02 - currentModel.rotation.y) * 0.08;
            } else if (gestureData === 'tilt') {
                currentModel.rotation.z += (angle * 0.015 - currentModel.rotation.z) * 0.06;
            } else if (gestureData === 'lookAway') {
                currentModel.rotation.y += (Math.sin(t * Math.PI) * 0.03 - currentModel.rotation.y) * 0.06;
            } else if (gestureData === 'wave') {
                currentModel.rotation.z += (Math.sin(t * Math.PI * 2) * 0.012 - currentModel.rotation.z) * 0.08;
                currentModel.rotation.x += (angle * 0.008 - currentModel.rotation.x) * 0.06;
            } else if (gestureData === 'shrug') {
                currentModel.rotation.z += (angle * 0.012 - currentModel.rotation.z) * 0.06;
            } else if (gestureData === 'think') {
                currentModel.rotation.z += (angle * 0.015 - currentModel.rotation.z) * 0.05;
                currentModel.rotation.x += (angle * 0.015 - currentModel.rotation.x) * 0.05;
            } else if (gestureData === 'point') {
                currentModel.rotation.x += (angle * 0.02 - currentModel.rotation.x) * 0.08;
            }
        } else if (gestureQueue.length > 0) {
            gestureData = gestureQueue.shift();
            gestureActive = true;
            gestureTimer = 0;
            gestureDuration = gestureData === 'shake' ? 1.0 : gestureData === 'wave' ? 1.2 : gestureData === 'think' ? 1.5 : 0.6;
        }
    }

    // ── Pose system (body posture) ────────────────────────────
    let currentPose = 'relaxed';
    let armBones = {
        leftShoulder: null, rightShoulder: null,
        leftArm: null, rightArm: null,
        leftForeArm: null, rightForeArm: null,
        leftHand: null, rightHand: null
    };

    function findArmBones() {
        if (!currentModel) return;
        armBones = {
            leftShoulder: null, rightShoulder: null,
            leftArm: null, rightArm: null,
            leftForeArm: null, rightForeArm: null,
            leftHand: null, rightHand: null
        };
        // Flexible bone matching for MetaPerson / Mixamo / generic models
        const allBones = [];
        currentModel.traverse(function (bone) {
            if (!bone.isBone) return;
            allBones.push(bone);
        });
        console.log('[Avatar] All bones:', allBones.map(function (b) { return b.name; }).join(', '));

        function findBone(patterns) {
            for (let pi = 0; pi < patterns.length; pi++) {
                for (let bi = 0; bi < allBones.length; bi++) {
                    if (allBones[bi].name === patterns[pi]) return allBones[bi];
                }
            }
            // Fuzzy fallback: case-insensitive contains
            const lowerPatterns = patterns.map(function (p) { return p.toLowerCase(); });
            for (let pi2 = 0; pi2 < lowerPatterns.length; pi2++) {
                for (let bi2 = 0; bi2 < allBones.length; bi2++) {
                    if (allBones[bi2].name.toLowerCase() === lowerPatterns[pi2]) return allBones[bi2];
                }
            }
            return null;
        }

        armBones.leftShoulder = findBone(['LeftShoulder', 'Left_Shoulder', 'shoulder_l', 'shoulder.L']);
        armBones.rightShoulder = findBone(['RightShoulder', 'Right_Shoulder', 'shoulder_r', 'shoulder.R']);
        armBones.leftArm = findBone(['LeftArm', 'LeftArm1', 'Left_Arm', 'upperarm_l', 'upper_arm.L']);
        armBones.rightArm = findBone(['RightArm', 'RightArm1', 'Right_Arm', 'upperarm_r', 'upper_arm.R']);
        armBones.leftForeArm = findBone(['LeftForeArm', 'LeftForeArm1', 'Left_ForeArm', 'lowerarm_l', 'forearm.L']);
        armBones.rightForeArm = findBone(['RightForeArm', 'RightForeArm1', 'Right_ForeArm', 'lowerarm_r', 'forearm.R']);
        armBones.leftHand = findBone(['LeftHand', 'Left_Hand', 'hand_l', 'hand.L']);
        armBones.rightHand = findBone(['RightHand', 'Right_Hand', 'hand_r', 'hand.R']);

        console.log('[Avatar] Arm bones found — LS:', !!(armBones.leftShoulder && armBones.leftShoulder.name), 'RS:', !!(armBones.rightShoulder && armBones.rightShoulder.name),
            'LA:', !!(armBones.leftArm && armBones.leftArm.name), 'RA:', !!(armBones.rightArm && armBones.rightArm.name),
            'LFA:', !!(armBones.leftForeArm && armBones.leftForeArm.name), 'RFA:', !!(armBones.rightForeArm && armBones.rightForeArm.name),
            'LH:', !!(armBones.leftHand && armBones.leftHand.name), 'RH:', !!(armBones.rightHand && armBones.rightHand.name));

        // Auto-compute arms-down quaternions from current A-pose
        _computeArmDownQuaternions();
    }

    // ══ Find eye, head, neck, spine bones ══════════════════════
    function _findEyeAndSpineBones() {
        if (!currentModel) return;
        _eyeBones = { left: null, right: null };
        _headBone = null;
        _spineBone = null;
        _neckBone = null;
        currentModel.traverse(function (bone) {
            if (!bone.isBone) return;
            const nm = bone.name;
            if (nm === 'LeftEye' || nm === 'Eye_L' || nm === 'leftEye') _eyeBones.left = bone;
            if (nm === 'RightEye' || nm === 'Eye_R' || nm === 'rightEye') _eyeBones.right = bone;
            if (nm === 'Head' || nm === 'head') _headBone = bone;
            if (nm === 'Neck' || nm === 'neck') _neckBone = bone;
            if (!_spineBone && (nm === 'Spine1' || nm === 'Spine2' || nm === 'Spine' || nm === 'spine')) _spineBone = bone;
        });
        console.log('[Avatar] Bones found — Head:', !!_headBone, 'Neck:', !!_neckBone,
            'Spine:', !!_spineBone, 'LeftEye:', !!_eyeBones.left, 'RightEye:', !!_eyeBones.right);
    }

    // ══ Compute arms-down quaternions dynamically from A-pose rest ══
    // MetaPerson models come in A-pose. We rotate shoulders ~55° downward
    // around their local Z axis to bring arms to a natural hanging position.
    let _computedArmDown = null;

    // Store rest-pose quaternions (captured ONCE when model loads)
    let _armRestLeft = null;
    let _armRestRight = null;
    let _currentArmAngle = 35; // DEFAULT: 35° — relaxed arms alongside body

    function _computeArmDownQuaternions(angleDeg) {
        if (typeof THREE === 'undefined') return;
        if (angleDeg !== undefined) _currentArmAngle = angleDeg;
        const angle = _currentArmAngle * Math.PI / 180;

        // Capture rest-pose quaternions ONCE
        if (!_armRestLeft && armBones.leftArm) _armRestLeft = armBones.leftArm.quaternion.clone();
        if (!_armRestRight && armBones.rightArm) _armRestRight = armBones.rightArm.quaternion.clone();

        _computedArmDown = {};

        // Left arm: rotate around local Z axis by -angle
        if (armBones.leftArm && _armRestLeft) {
            const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -angle);
            _computedArmDown.la = _armRestLeft.clone().multiply(delta);
        }
        // Right arm: rotate around local Z axis by +angle (mirrored)
        if (armBones.rightArm && _armRestRight) {
            const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle);
            _computedArmDown.ra = _armRestRight.clone().multiply(delta);
        }

        console.log('[Avatar] Arm-down:', _currentArmAngle + '°');
    }

    // ── CALIBRATION SLIDER UI ──────────────────────────────
    function showArmCalibrator() {
        if (document.getElementById('arm-calibrator')) { document.getElementById('arm-calibrator').remove(); }
        const panel = document.createElement('div');
        panel.id = 'arm-calibrator';
        panel.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(0,0,0,0.95);border:1px solid #6366f1;border-radius:12px;padding:12px 20px;display:flex;flex-direction:column;align-items:center;gap:4px;font-family:var(--kelion-font);color:#fff;min-width:340px;';
        function row(label, id, val, color) {
            return '<div style="display:flex;align-items:center;gap:6px;width:100%;"><span style="font-size:0.75rem;font-weight:700;color:' + color + ';width:18px;">' + label + '</span><input type="range" id="' + id + '" min="-90" max="90" value="' + val + '" style="flex:1;accent-color:' + color + ';height:16px;"><span id="' + id + '-v" style="font-size:0.8rem;font-weight:700;color:' + color + ';width:40px;text-align:right;">' + val + '°</span></div>';
        }
        panel.innerHTML = '<div style="font-size:0.85rem;font-weight:600;">🔧 Brațe L / R</div>' +
            '<div style="font-size:0.7rem;color:#f97316;">── Stânga ──</div>' +
            row('X', 'lx', _armL.x, '#ef4444') + row('Y', 'ly', _armL.y, '#22c55e') + row('Z', 'lz', _armL.z, '#3b82f6') +
            '<div style="font-size:0.7rem;color:#f97316;">── Dreapta ──</div>' +
            row('X', 'rx', _armR.x, '#ef4444') + row('Y', 'ry', _armR.y, '#22c55e') + row('Z', 'rz', _armR.z, '#3b82f6') +
            '<div style="font-size:0.6rem;color:#555;">X=sus/jos Y=twist Z=față/spate</div>' +
            '<button id="arm-cal-close" style="padding:3px 14px;background:#6366f1;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.75rem;">Închide</button>';
        document.body.appendChild(panel);
        const lmap = {lx:'x',ly:'y',lz:'z'};
        ['lx','ly','lz'].forEach(function(id) {
            document.getElementById(id).addEventListener('input', function() {
                const v = parseInt(this.value);
                document.getElementById(id + '-v').textContent = v + '°';
                _armL[lmap[id]] = v;
            });
        });
        const rmap = {rx:'x',ry:'y',rz:'z'};
        ['rx','ry','rz'].forEach(function(id) {
            document.getElementById(id).addEventListener('input', function() {
                const v = parseInt(this.value);
                document.getElementById(id + '-v').textContent = v + '°';
                _armR[rmap[id]] = v;
            });
        });
        document.getElementById('arm-cal-close').addEventListener('click', function() { panel.remove(); });
    }

    // MetaPerson bone quaternions for arm poses
    // These are now computed dynamically in _computeArmDownQuaternions()
    const ARM_POSES = {
        relaxed: {
            ls: null, rs: null,  // will be set by _computeArmDownQuaternions
            la: [0.0, 0.0, 0.0, 1.0],
            ra: [0.0, 0.0, 0.0, 1.0]
        },
        presenting: {
            ls: null, rs: null,  // will be set by _computeArmDownQuaternions
            la: [0.0, 0.0, 0.0, 1.0],
            ra: [0.0, 0.0, 0.0, 1.0]
        },
        open: {
            // Keep original A-pose (null = don't override, stay in rest)
            ls: null, rs: null,
            la: [0.0, 0.0, 0.0, 1.0],
            ra: [0.0, 0.0, 0.0, 1.0]
        }
    };

    function setPose(pose) {
        currentPose = pose || 'relaxed';
        if (!armBones.leftShoulder && !armBones.rightShoulder) findArmBones();
        _enforcePose();
        console.log('[Avatar] Pose set:', currentPose);
    }

    const _mixerArmsStopped = false;
    // Independent L/R arm rotation (Euler degrees)
    const _armL = { x: 27, y: -9, z: -4 }; // LEFT arm defaults (user-calibrated)
    const _armR = { x: 27, y: -9, z: -4 }; // RIGHT arm defaults (user-calibrated)

    function _enforcePose() {
        if (typeof THREE === 'undefined') return;
        if (!_armRestLeft || !_armRestRight || !armBones.leftArm || !armBones.rightArm) return;

        // Left arm
        if (_armL.x !== 0 || _armL.y !== 0 || _armL.z !== 0) {
            const rx = _armL.x * Math.PI / 180;
            const ry = _armL.y * Math.PI / 180;
            const rz = _armL.z * Math.PI / 180;
            const deltaL = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, -ry, -rz, 'XYZ'));
            armBones.leftArm.quaternion.copy(_armRestLeft).multiply(deltaL);
        }
        // Right arm
        if (_armR.x !== 0 || _armR.y !== 0 || _armR.z !== 0) {
            const rx = _armR.x * Math.PI / 180;
            const ry = _armR.y * Math.PI / 180;
            const rz = _armR.z * Math.PI / 180;
            const deltaR = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
            armBones.rightArm.quaternion.copy(_armRestRight).multiply(deltaR);
        }
    }

    function updateExpression(dt) {
        const speed = 3 * dt;
        const allKeys = {};
        let k;
        for (k in targetExpression) allKeys[k] = true;
        for (k in currentExpression) allKeys[k] = true;
        for (k in allKeys) {
            const target = targetExpression[k] || 0;
            const current = currentExpression[k] || 0;
            const next = current + (target - current) * speed;
            if (Math.abs(next) < 0.001 && target === 0) delete currentExpression[k];
            else { currentExpression[k] = next; setMorph(k, next); }
        }
    }

    // ══ Body Action system — Euler-based arm bone animations ══
    let _bodyActionActive = false;
    let _bodyActionTimer = 0;
    let _bodyActionDuration = 2.0;
    let _bodyActionType = null;
    const _armDefaultL = { x: 27, y: -9, z: -4 };
    const _armDefaultR = { x: 27, y: -9, z: -4 };
    const _BODY_EULER = {
        raiseLeftHand:   { lx: -40, ly: 0, lz: 0, rx: null, ry: null, rz: null, dur: 2.5 },
        raiseRightHand:  { lx: null, ly: null, lz: null, rx: -40, ry: 0, rz: 0, dur: 2.5 },
        wavLeft:         { lx: -50, ly: 0, lz: 15, rx: null, ry: null, rz: null, dur: 2.0 },
        wavRight:        { lx: null, ly: null, lz: null, rx: -50, ry: 0, rz: -15, dur: 2.0 },
        pointLeft:       { lx: -20, ly: 0, lz: 30, rx: null, ry: null, rz: null, dur: 2.0 },
        pointRight:      { lx: null, ly: null, lz: null, rx: -20, ry: 0, rz: -30, dur: 2.0 },
        thinkPose:       { lx: null, ly: null, lz: null, rx: -55, ry: 20, rz: -15, dur: 3.0 },
        crossArms:       { lx: -10, ly: 30, lz: -20, rx: -10, ry: -30, rz: 20, dur: 2.5 },
        handsOnHips:     { lx: 10, ly: 20, lz: -15, rx: 10, ry: -20, rz: 15, dur: 2.5 },
        clap:            { lx: -30, ly: 15, lz: -10, rx: -30, ry: -15, rz: 10, dur: 1.5 },
        thumbsUpLeft:    { lx: -45, ly: 0, lz: 0, rx: null, ry: null, rz: null, dur: 2.0 },
        thumbsUpRight:   { lx: null, ly: null, lz: null, rx: -45, ry: 0, rz: 0, dur: 2.0 },
        fistPumpLeft:    { lx: -60, ly: 0, lz: 0, rx: null, ry: null, rz: null, dur: 2.0 },
        fistPumpRight:   { lx: null, ly: null, lz: null, rx: -60, ry: 0, rz: 0, dur: 2.0 },
        shakeHands:      { lx: null, ly: null, lz: null, rx: -20, ry: 0, rz: -25, dur: 2.5 },
        headScratch:     { lx: null, ly: null, lz: null, rx: -65, ry: 15, rz: 0, dur: 2.5 },
        facepalm:        { lx: null, ly: null, lz: null, rx: -60, ry: 15, rz: -10, dur: 2.0 },
        salute:          { lx: null, ly: null, lz: null, rx: -55, ry: 10, rz: 0, dur: 2.0 },
        bow:             { lx: 10, ly: 0, lz: 0, rx: 10, ry: 0, rz: 0, dur: 2.5 },
    };

    function playBodyAction(type) {
        const action = _BODY_EULER[type];
        if (!action) { console.warn('[Avatar] Unknown body action:', type); return; }
        _bodyActionType = type;
        _bodyActionActive = true;
        _bodyActionTimer = 0;
        _bodyActionDuration = action.dur || 2.0;
        console.log('[Avatar] Body action:', type, '(' + _bodyActionDuration + 's)');
    }

    function updateBodyAction(dt) {
        if (!_bodyActionActive || !_bodyActionType) return;
        _bodyActionTimer += dt;
        const action = _BODY_EULER[_bodyActionType];
        if (!action) { _bodyActionActive = false; return; }
        const t = _bodyActionTimer / _bodyActionDuration;
        const blend = Math.sin(Math.min(t, 1.0) * Math.PI);
        if (t >= 1.0) {
            _armL.x = _armDefaultL.x; _armL.y = _armDefaultL.y; _armL.z = _armDefaultL.z;
            _armR.x = _armDefaultR.x; _armR.y = _armDefaultR.y; _armR.z = _armDefaultR.z;
            _bodyActionActive = false; _bodyActionTimer = 0; _bodyActionType = null;
            return;
        }
        if (action.lx !== null) _armL.x = _armDefaultL.x + (action.lx - _armDefaultL.x) * blend;
        if (action.ly !== null) _armL.y = _armDefaultL.y + (action.ly - _armDefaultL.y) * blend;
        if (action.lz !== null) _armL.z = _armDefaultL.z + (action.lz - _armDefaultL.z) * blend;
        if (action.rx !== null) _armR.x = _armDefaultR.x + (action.rx - _armDefaultR.x) * blend;
        if (action.ry !== null) _armR.y = _armDefaultR.y + (action.ry - _armDefaultR.y) * blend;
        if (action.rz !== null) _armR.z = _armDefaultR.z + (action.rz - _armDefaultR.z) * blend;
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!renderer || !scene || !camera) return; // Guard against init race
        const dt = clock.getDelta();
        try {
            // Mixer provides base idle animation from GLB model
            // Brain controls changes via [GESTURE:xxx] [POSE:xxx] [EMOTION:xxx] tags
            if (mixer) mixer.update(dt);
            _enforcePose();

            updateBlink(dt);
            updateExpression(dt);
            // Professional lip sync: alignment-driven (priority) or FFT fallback
            if (window.AlignmentLipSync && AlignmentLipSync.isActive()) {
                AlignmentLipSync.update();
            } else if (lipSync && window.KVoice && KVoice.isSpeaking()) {
                lipSync.update();
            }

            updateGesture(dt);
            updateBodyAction(dt);
            updateMoodLighting();

            // ══ BRAIN-ONLY MOVEMENT — no hardcoded body animations ══
            // Only natural functions remain: blink, lip sync, eye tracking, breathing, micro-expressions.

            // ══ Breathing (Spine bone gentle movement) ═══════════════
            _breathPhase += dt * BREATH_SPEED;
            if (_spineBone) {
                const breathVal = Math.sin(_breathPhase * Math.PI * 2) * BREATH_AMOUNT;
                _spineBone.rotation.x += (breathVal - (_spineBone.rotation.x - (_spineBone._baseRotX || 0))) * 0.1;
                if (!_spineBone._baseRotX) _spineBone._baseRotX = _spineBone.rotation.x;
            }

            // ══ Head Tracking (head follows mouse subtly) ═════════════
            if (_headBone) {
                const headYaw = _mouseX * 0.15;   // was 0.25 — subtler head turn
                const headPitch = _mouseY * 0.08; // was 0.12 — subtler pitch
                _headBone.rotation.y += (headYaw - _headBone.rotation.y) * 0.04; // was 0.08 — smoother
                _headBone.rotation.x += (headPitch - _headBone.rotation.x) * 0.04;
            }

            // ══ Micro-expressions (subtle face twitches) ══════════════
            _microTimer += dt;
            if (!_microActive && _microTimer >= _nextMicro) {
                _microActive = true;
                _microTimer = 0;
                _microElapsed = 0;
                const me = MICRO_EXPRESSIONS[Math.floor(Math.random() * MICRO_EXPRESSIONS.length)];
                _microMorph = me.morph;
                _microValue = me.max;
                _microDuration = me.duration;
                _nextMicro = 3 + Math.random() * 5;
            }
            if (_microActive) {
                _microElapsed += dt;
                const mt = _microElapsed / _microDuration;
                if (mt >= 1) {
                    _microActive = false;
                    setMorph(_microMorph, 0);
                } else {
                    setMorph(_microMorph, Math.sin(mt * Math.PI) * _microValue);
                }
            }

            // ══ Finger Pose (enforce every frame) ═══════════════════
            _enforceFingerPose();

            // ══ Eye Saccades (natural micro-movements) ══════════════
            _saccadeTimer += dt;
            if (_saccadeTimer >= _nextSaccade) {
                _saccadeTimer = 0;
                _nextSaccade = 0.5 + Math.random() * 2;
                _saccadeTargetX = (Math.random() - 0.5) * 0.03;
                _saccadeTargetY = (Math.random() - 0.5) * 0.015;
            }
            _saccadeCurrentX += (_saccadeTargetX - _saccadeCurrentX) * 0.25;
            _saccadeCurrentY += (_saccadeTargetY - _saccadeCurrentY) * 0.25;

            // ══ Eye Tracking — MORPH-BASED PRIMARY (parallel gaze, no cross-eye) ══
            // Morph targets handle left/right correctly by design:
            //   eyeLookOutLeft  = left eye looks LEFT  (away from nose)
            //   eyeLookInLeft   = left eye looks RIGHT (toward nose)
            //   eyeLookOutRight = right eye looks RIGHT (away from nose)
            //   eyeLookInRight  = right eye looks LEFT  (toward nose)
            // When _mouseX > 0 (looking RIGHT): LookInLeft + LookOutRight → both eyes right ✓
            // When _mouseX < 0 (looking LEFT):  LookOutLeft + LookInRight → both eyes left ✓
            const gazeX = _mouseX * 0.35 + _saccadeCurrentX;
            const gazeY = _mouseY * 0.25 + _saccadeCurrentY;

            // Horizontal gaze (parallel — both eyes look the same direction)
            setMorph('eyeLookInLeft',    Math.max(0,  gazeX * 0.6));  // left eye → right
            setMorph('eyeLookOutLeft',   Math.max(0, -gazeX * 0.6));  // left eye → left
            setMorph('eyeLookOutRight',  Math.max(0,  gazeX * 0.6));  // right eye → right
            setMorph('eyeLookInRight',   Math.max(0, -gazeX * 0.6));  // right eye → left
            // Vertical gaze
            setMorph('eyeLookUpLeft',    Math.max(0,  gazeY * 0.4));
            setMorph('eyeLookUpRight',   Math.max(0,  gazeY * 0.4));
            setMorph('eyeLookDownLeft',  Math.max(0, -gazeY * 0.4));
            setMorph('eyeLookDownRight', Math.max(0, -gazeY * 0.4));

            // ══ Bone-based eye rotation — SUBTLE SUPPLEMENT ONLY ══
            // Very gentle embellishment (10x less than before), with mirror correction
            if (_eyeBones.left) {
                _eyeBones.left.rotation.y += (gazeX * 0.04 - _eyeBones.left.rotation.y) * 0.06;
                _eyeBones.left.rotation.x += (gazeY * 0.03 - _eyeBones.left.rotation.x) * 0.06;
            }
            if (_eyeBones.right) {
                // MIRROR CORRECTION: negate Y for right eye bone (mirrored skeleton)
                _eyeBones.right.rotation.y += (-gazeX * 0.04 - _eyeBones.right.rotation.y) * 0.06;
                _eyeBones.right.rotation.x += (gazeY * 0.03 - _eyeBones.right.rotation.x) * 0.06;
            }

            // Body stays STILL — only brain-triggered gestures move the model
            // (via updateGesture which is already called above)
            if (currentModel && !isPresenting && !isAttentive && !gestureActive) {
                // Return to neutral — very gentle, no snapping
                currentModel.rotation.y += (0 - currentModel.rotation.y) * 0.02; // was 0.05
                currentModel.rotation.x += (0 - currentModel.rotation.x) * 0.02;
                currentModel.rotation.z += (0 - currentModel.rotation.z) * 0.02;
            } else if (currentModel && isPresenting) {
                currentModel.rotation.y += (-PRESENT_ANGLE - currentModel.rotation.y) * 0.04; // was 0.08
            } else if (currentModel && isAttentive) {
                currentModel.rotation.y += (_mouseX * 0.02 - currentModel.rotation.y) * 0.03; // was 0.04/0.05
            }
            // SMOOTH mouth close — exponential decay instead of instant zero
            const _lipRan = (window.AlignmentLipSync && AlignmentLipSync.isActive()) || (lipSync && window.KVoice && KVoice.isSpeaking());
            if (!_lipRan) {
                for (let ci = 0; ci < _mouthMorphCache.length; ci++) {
                    const curr = _mouthMorphCache[ci].mesh.morphTargetInfluences[_mouthMorphCache[ci].idx];
                    _mouthMorphCache[ci].mesh.morphTargetInfluences[_mouthMorphCache[ci].idx] = curr * 0.70; // TEST-A: faster mouth close
                }
            }
        } catch (e) {
            // Don't let errors kill the render loop
            if (!animate._errLogged) { console.error('[Avatar] Animate error:', e.message); animate._errLogged = true; }
        }
        renderer.render(scene, camera);
    }

    function onResize() {
        const canvas = document.getElementById('avatar-canvas');
        if (!canvas || !renderer) return;
        const container = canvas.parentElement;
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }

    // ── Finger Pose System ─────────────────────────────────────
    // Each finger has 4 joints (1=base, 4=tip). Rotation is on X axis (curl).
    const FINGER_POSES = {
        relaxed: { curl: 0.15 },   // slightly curled, natural
        fist: { curl: 1.4 },    // fully closed
        open: { curl: 0 },      // flat, spread
        point: { index: 0, others: 1.3 },  // index straight, rest curled
        thumbsup: { thumb: -0.3, others: 1.3 } // thumb out, rest curled
    };

    function setFingerPose(hand, pose) {
        const bones = (hand === 'left') ? _fingerBones.left : _fingerBones.right;
        if (!bones || Object.keys(bones).length === 0) return;
        const p = FINGER_POSES[pose] || FINGER_POSES.relaxed;
        const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
        for (let i = 0; i < fingerNames.length; i++) {
            const fn = fingerNames[i];
            const joints = bones[fn];
            if (!joints) continue;
            let curl = p.curl !== undefined ? p.curl : 0;
            // Special per-finger overrides (for point/thumbsup)
            if (fn === 'Index' && p.index !== undefined) curl = p.index;
            else if (fn === 'Thumb' && p.thumb !== undefined) curl = p.thumb;
            else if (fn !== 'Index' && fn !== 'Thumb' && p.others !== undefined) curl = p.others;
            for (let j = 0; j < joints.length; j++) {
                joints[j].rotation.x += (curl - joints[j].rotation.x) * 0.15;
            }
        }
    }

    // Default finger pose — apply every frame for consistency
    let _currentFingerPose = 'relaxed';
    function _enforceFingerPose() {
        setFingerPose('left', _currentFingerPose);
        setFingerPose('right', _currentFingerPose);
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
        playBodyAction: playBodyAction,
        setMorph: setMorph,
        setAttentive: function (v) { isAttentive = v; },
        setPresenting: function (v) { isPresenting = v; },
        setPose: setPose,
        setFingerPose: function (hand, pose) {
            if (!hand) { _currentFingerPose = pose || 'relaxed'; return; }
            setFingerPose(hand, pose);
        },
        findArmBones: findArmBones,
        showArmCalibrator: showArmCalibrator,
        setArmAngle: function (deg) { _computeArmDownQuaternions(deg); },
        toggleBackground: function () {
            if (!scene) return;
            if (scene.background && scene.background.isTexture) {
                scene._savedBg = scene.background;
                scene.background = new THREE.Color(0x111111);
                console.log('[Avatar] Background OFF (solid dark)');
            } else if (scene._savedBg) {
                scene.background = scene._savedBg;
                console.log('[Avatar] Background ON (texture)');
            }
        },
        setZoom: function (z) {
            if (!camera) return;
            camera.position.z = z;
            console.log('[Avatar] Zoom:', z);
        },
        showCameraCalibrator: function () {
            if (document.getElementById('camera-calibrator')) { document.getElementById('camera-calibrator').remove(); }
            const p = document.createElement('div');
            p.id = 'camera-calibrator';
            p.style.cssText = 'position:fixed;top:80px;right:20px;z-index:9999;background:rgba(0,0,0,0.95);border:1px solid #6366f1;border-radius:12px;padding:16px 20px;display:flex;flex-direction:column;align-items:center;gap:6px;font-family:var(--kelion-font);color:#fff;min-width:280px;';
            const curY = camera ? Math.round(camera.position.y * 100) : 45;
            const curZ = camera ? Math.round(camera.position.z * 100) : 190;
            const curMY = currentModel ? Math.round(currentModel.position.y * 100) : -8;
            function row(label, id, min, max, val, color) {
                return '<div style="display:flex;align-items:center;gap:6px;width:100%;">' +
                    '<span style="font-size:0.75rem;font-weight:700;color:' + color + ';width:60px;">' + label + '</span>' +
                    '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + val + '" style="flex:1;accent-color:' + color + ';height:16px;">' +
                    '<span id="' + id + '-v" style="font-size:0.85rem;font-weight:700;color:' + color + ';width:50px;text-align:right;">' + (val / 100).toFixed(2) + '</span></div>';
            }
            p.innerHTML = '<div style="font-size:0.9rem;font-weight:600;">📐 Camera Calibrator</div>' +
                row('Cam Y ↕', 'cam-y', 0, 100, curY, '#22c55e') +
                row('Zoom Z', 'cam-z', 100, 300, curZ, '#3b82f6') +
                row('Model Y', 'mod-y', -50, 50, curMY, '#f59e0b') +
                '<div id="cam-values" style="font-size:0.7rem;color:#888;margin-top:4px;">cam(0, ' + (curY / 100).toFixed(2) + ', ' + (curZ / 100).toFixed(2) + ') model.y=' + (curMY / 100).toFixed(2) + '</div>' +
                '<button id="cam-cal-close" style="padding:4px 16px;background:#6366f1;border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.8rem;margin-top:4px;">Închide</button>';
            document.body.appendChild(p);
            function updateValues() {
                const y = parseInt(document.getElementById('cam-y').value);
                const z = parseInt(document.getElementById('cam-z').value);
                const my = parseInt(document.getElementById('mod-y').value);
                document.getElementById('cam-values').textContent =
                    'cam(0, ' + (y / 100).toFixed(2) + ', ' + (z / 100).toFixed(2) + ') model.y=' + (my / 100).toFixed(2);
            }
            document.getElementById('cam-y').addEventListener('input', function () {
                const v = parseInt(this.value) / 100;
                document.getElementById('cam-y-v').textContent = v.toFixed(2);
                if (camera) camera.position.y = v;
                updateValues();
            });
            document.getElementById('cam-z').addEventListener('input', function () {
                const v = parseInt(this.value) / 100;
                document.getElementById('cam-z-v').textContent = v.toFixed(2);
                if (camera) camera.position.z = v;
                updateValues();
            });
            document.getElementById('mod-y').addEventListener('input', function () {
                const v = parseInt(this.value) / 100;
                document.getElementById('mod-y-v').textContent = v.toFixed(2);
                if (currentModel) currentModel.position.y = v;
                updateValues();
            });
            document.getElementById('cam-cal-close').addEventListener('click', function () { p.remove(); });
        },
        // Legacy alias
        showZoomCalibrator: function () { window.KAvatar.showCameraCalibrator(); },
        setEyeGaze: function (direction, intensity) {
            intensity = intensity || 0.4;
            const target = { up: 0, down: 0, left: 0, right: 0 };
            const gazeMap = {
                'center':     {},
                'left':       { left: intensity },
                'right':      { right: intensity },
                'up':         { up: intensity },
                'down':       { down: intensity },
                'up-left':    { up: intensity * 0.7, left: intensity * 0.7 },
                'up-right':   { up: intensity * 0.7, right: intensity * 0.7 },
                'down-left':  { down: intensity * 0.7, left: intensity * 0.7 },
                'down-right': { down: intensity * 0.7, right: intensity * 0.7 },
            };
            const g = gazeMap[direction] || {};
            Object.assign(target, g);
            // Apply directly using setMorph — smooth enough via RPM blendshapes
            setMorph('eyeLookUpLeft',    target.up);
            setMorph('eyeLookUpRight',   target.up);
            setMorph('eyeLookDownLeft',  target.down);
            setMorph('eyeLookDownRight', target.down);
            // Left gaze: left-eye Out, right-eye In
            setMorph('eyeLookOutLeft',   target.left);
            setMorph('eyeLookInRight',   target.left);
            // Right gaze: left-eye In, right-eye Out
            setMorph('eyeLookInLeft',    target.right);
            setMorph('eyeLookOutRight',  target.right);
        },
        startEyeIdle: function () {
            if (this._eyeIdleTimer) return;
            const self = this;
            const directions = ['center', 'center', 'center', 'left', 'right', 'up', 'up-left', 'up-right', 'down'];
            function nextGaze() {
                const dir = directions[Math.floor(Math.random() * directions.length)];
                const intensity = 0.1 + Math.random() * 0.25;
                self.setEyeGaze(dir, intensity);
                const delay = 1500 + Math.random() * 3000;
                self._eyeIdleTimer = setTimeout(nextGaze, delay);
            }
            nextGaze();
        },
        stopEyeIdle: function () {
            if (this._eyeIdleTimer) { clearTimeout(this._eyeIdleTimer); this._eyeIdleTimer = null; }
            this.setEyeGaze('center');
        },
        _eyeIdleTimer: null,
        getLipSync: function () { return lipSync; },
        getTextLipSync: function () { return textLipSync; },
        getMorphMeshes: function () { return morphMeshes; },
        onResize: onResize
    };
})();
