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
    let initRetryCount = 0;
    const MAX_INIT_RETRIES = 50; // up to 5s total

    // Blink
    let blinkTimer = 0, nextBlink = 2 + Math.random() * 4, blinkPhase = 0, blinkValue = 0;

    // Expression
    let targetExpression = {}, currentExpression = {};
    let currentExpressionName = 'neutral';

    // Mouth morph cache — populated at loadAvatar, used in animate for force-close
    let _mouthMorphCache = [];
    function _cacheMouthMorphs() {
        _mouthMorphCache = [];
        morphMeshes.forEach(function (m) {
            if (!m.morphTargetDictionary || !m.morphTargetInfluences) return;
            Object.keys(m.morphTargetDictionary).forEach(function (k) {
                var kl = k.toLowerCase();
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
    var PRESENT_ANGLE = 8 * Math.PI / 180; // 8 degrees right

    // ══ INNOVATIVE: Eye Tracking (mouse follow) ══════════════
    var _mouseX = 0, _mouseY = 0;
    var _eyeBones = { left: null, right: null };
    var _headBone = null;
    var _spineBone = null;
    document.addEventListener('mousemove', function (e) {
        // Normalize to -1..1 from viewport center
        _mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        _mouseY = -((e.clientY / window.innerHeight) * 2 - 1);
    });

    // ══ INNOVATIVE: Micro-expressions ═════════════════════════
    var _microTimer = 0;
    var _nextMicro = 3 + Math.random() * 5; // 3-8s between twitches
    var _microActive = false;
    var _microMorph = '';
    var _microValue = 0;
    var _microDuration = 0;
    var _microElapsed = 0;
    var MICRO_EXPRESSIONS = [
        { morph: 'browInnerUp', max: 0.15, duration: 0.3 },
        { morph: 'browOuterUpLeft', max: 0.12, duration: 0.25 },
        { morph: 'browOuterUpRight', max: 0.12, duration: 0.25 },
        { morph: 'cheekSquintLeft', max: 0.1, duration: 0.2 },
        { morph: 'cheekSquintRight', max: 0.1, duration: 0.2 },
        { morph: 'noseSneerLeft', max: 0.08, duration: 0.15 },
        { morph: 'noseSneerRight', max: 0.08, duration: 0.15 },
        { morph: 'mouthPressLeft', max: 0.06, duration: 0.2 },
        { morph: 'mouthSmileLeft', max: 0.08, duration: 0.3 },
        { morph: 'eyeSquintLeft', max: 0.1, duration: 0.2 },
        { morph: 'eyeSquintRight', max: 0.1, duration: 0.2 }
    ];

    // ══ INNOVATIVE: Eye Saccades ══════════════════════════════
    var _saccadeTimer = 0;
    var _nextSaccade = 0.5 + Math.random() * 2; // 0.5-2.5s
    var _saccadeTargetX = 0, _saccadeTargetY = 0;
    var _saccadeCurrentX = 0, _saccadeCurrentY = 0;

    // ══ INNOVATIVE: Breathing ═════════════════════════════════
    var _breathPhase = 0;
    var BREATH_SPEED = 0.8; // ~4s per full cycle
    var BREATH_AMOUNT = 0.003; // Very subtle

    // Expression intensity table (smarter than fixed 0.5)
    var EXPRESSION_INTENSITY = {
        happy: 0.5, thinking: 0.35, concerned: 0.4, neutral: 0,
        laughing: 0.7, surprised: 0.6, playful: 0.5,
        sad: 0.45, determined: 0.4, loving: 0.5, sleepy: 0.3
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

        camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
        camera.position.set(0, -0.1, 1.8); // Negative Y = avatar appears higher
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
        if (window.TextLipSync) textLipSync = new TextLipSync({ msPerChar: 38 });

        loadAvatar('kelion').then(function () {
            console.log('[Avatar] Kelion loaded');
            // Preload Kira model silently into browser cache
            var preloader = new THREE.GLTFLoader();
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
                currentModel.position.y -= 0.15;

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

                // ARM POSE — find bones and set default relaxed pose
                findArmBones();
                _findEyeAndSpineBones(); // NEW: find eye/head/spine for life system
                setPose('relaxed');

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
                currentModel.rotation.x += (-currentModel.rotation.x) * 0.1;
                currentModel.rotation.y += (-currentModel.rotation.y) * 0.1;
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
            } else if (gestureData === 'wave') {
                // Subtle head tilt + slight body sway (friendly wave)
                currentModel.rotation.z += (Math.sin(t * Math.PI * 2) * 0.08 - currentModel.rotation.z) * 0.2;
                currentModel.rotation.x += (angle * 0.05 - currentModel.rotation.x) * 0.15;
            } else if (gestureData === 'shrug') {
                // Shoulders up — tilt only, NO vertical movement
                currentModel.rotation.z += (angle * 0.06 - currentModel.rotation.z) * 0.15;
            } else if (gestureData === 'think') {
                // Head tilt + look slightly down (contemplation)
                currentModel.rotation.z += (angle * 0.08 - currentModel.rotation.z) * 0.12;
                currentModel.rotation.x += (angle * 0.1 - currentModel.rotation.x) * 0.12;
            } else if (gestureData === 'point') {
                // Slight forward lean + head nod (indicating)
                currentModel.rotation.x += (angle * 0.12 - currentModel.rotation.x) * 0.2;
            }
        } else if (gestureQueue.length > 0) {
            gestureData = gestureQueue.shift();
            gestureActive = true;
            gestureTimer = 0;
            gestureDuration = gestureData === 'shake' ? 1.0 : gestureData === 'wave' ? 1.2 : gestureData === 'think' ? 1.5 : 0.6;
        }
    }

    // ── Pose system (body posture) ────────────────────────────
    var currentPose = 'relaxed';
    var armBones = { left: null, right: null };

    function findArmBones() {
        if (!currentModel) return;
        armBones = { left: null, right: null };
        currentModel.traverse(function (bone) {
            if (!bone.isBone) return;
            var bn = (bone.name || '').toLowerCase();
            if (bn.indexOf('leftupperarm') !== -1 || bn.indexOf('left_upper_arm') !== -1 ||
                bn.indexOf('lupperarm') !== -1 || bn === 'leftarm' || bn === 'left_arm') {
                armBones.left = bone;
            }
            if (bn.indexOf('rightupperarm') !== -1 || bn.indexOf('right_upper_arm') !== -1 ||
                bn.indexOf('rupperarm') !== -1 || bn === 'rightarm' || bn === 'right_arm') {
                armBones.right = bone;
            }
        });
        console.log('[Avatar] Arm bones found:', !!armBones.left, !!armBones.right);
    }

    // ══ Find eye bones, head bone, spine bone for life system ══
    function _findEyeAndSpineBones() {
        if (!currentModel) return;
        _eyeBones = { left: null, right: null };
        _headBone = null;
        _spineBone = null;
        currentModel.traverse(function (bone) {
            if (!bone.isBone) return;
            var bn = (bone.name || '').toLowerCase();
            // Eye bones
            if (bn.indexOf('lefteye') !== -1 || bn.indexOf('left_eye') !== -1 || bn === 'eye_l') {
                _eyeBones.left = bone;
            }
            if (bn.indexOf('righteye') !== -1 || bn.indexOf('right_eye') !== -1 || bn === 'eye_r') {
                _eyeBones.right = bone;
            }
            // Head bone
            if (!_headBone && (bn === 'head' || bn.indexOf('head') !== -1) && bn.indexOf('headtop') === -1) {
                _headBone = bone;
            }
            // Spine (for breathing)
            if (!_spineBone && (bn === 'spine' || bn === 'spine1' || bn === 'spine2' || bn.indexOf('spine') !== -1)) {
                _spineBone = bone;
            }
        });
        console.log('[Avatar] Life system bones — eyes:', !!_eyeBones.left, !!_eyeBones.right,
            '| head:', !!_headBone, '| spine:', !!_spineBone);
    }

    function setPose(pose) {
        currentPose = pose || 'relaxed';
        if (!armBones.left && !armBones.right) findArmBones();

        // MetaPerson / Avaturn models use different bone orientations than RPM
        var poses = {
            // BUSINESS: try Y-axis for arms DOWN (Z and X both went forward)
            relaxed: { lx: 0, rx: 0, ly: 0, ry: 0, lz: 1.2, rz: -1.2 },
            presenting: { lx: 0, rx: 0, ly: 0, ry: 0, lz: 0.7, rz: -0.7 },
            crossed: { lx: 0.3, rx: 0.3, ly: 0, ry: 0, lz: 1.4, rz: -1.4 },
            open: { lx: 0, rx: 0, ly: 0, ry: 0, lz: 0.4, rz: -0.4 }
        };
        _targetPose = poses[currentPose] || poses.relaxed;
        _enforcePose(); // Apply immediately
        console.log('[Avatar] Pose set:', currentPose);
    }

    // Default pose values (arms by body)
    var _targetPose = { lx: 0, rx: 0, ly: 0, ry: 0, lz: 1.2, rz: -1.2 };

    // Called EVERY frame after mixer.update() — FORCE arms to target position
    // Uses lazy Euler init (THREE may not be ready at parse time)
    var _tmpEuler = null;
    var _mixerArmsStopped = false;
    function _enforcePose() {
        if (!_targetPose) return;
        // Lazy init — THREE must be available by animation time
        if (!_tmpEuler && typeof THREE !== 'undefined') {
            _tmpEuler = new THREE.Euler();
            console.log('[Avatar] _enforcePose: Euler initialized ✅');
        }
        if (!_tmpEuler) return;

        // Stop mixer from animating arm bones (one-time)
        if (!_mixerArmsStopped && mixer && mixer._actions) {
            mixer._actions.forEach(function (action) {
                if (!action || !action._clip) return;
                var clip = action._clip;
                var tracksToRemove = [];
                clip.tracks.forEach(function (track, idx) {
                    var tn = track.name.toLowerCase();
                    if (tn.indexOf('leftarm') !== -1 || tn.indexOf('rightarm') !== -1 ||
                        tn.indexOf('left_arm') !== -1 || tn.indexOf('right_arm') !== -1) {
                        tracksToRemove.push(idx);
                    }
                });
                // Remove arm tracks from clip (reverse order to keep indices valid)
                for (var i = tracksToRemove.length - 1; i >= 0; i--) {
                    clip.tracks.splice(tracksToRemove[i], 1);
                    console.log('[Avatar] Removed arm track from animation clip');
                }
            });
            _mixerArmsStopped = true;
        }

        var p = _targetPose;
        if (armBones.left) {
            _tmpEuler.set(p.lx, p.ly, p.lz);
            armBones.left.quaternion.setFromEuler(_tmpEuler);
        }
        if (armBones.right) {
            _tmpEuler.set(p.rx, p.ry, p.rz);
            armBones.right.quaternion.setFromEuler(_tmpEuler);
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
        // Mixer provides base idle animation from GLB model
        // Brain controls changes via [GESTURE:xxx] [POSE:xxx] [EMOTION:xxx] tags
        if (mixer) mixer.update(dt);


        updateBlink(dt);
        updateExpression(dt);
        if (lipSync && window.KVoice && KVoice.isSpeaking()) lipSync.update();

        updateGesture(dt);
        updateMoodLighting();

        // ══ BRAIN-ONLY MOVEMENT — no hardcoded body animations ══
        // Micro-expressions, idle sway, breathing spine movement are DISABLED.
        // All body movement comes from AI brain via [GESTURE:xxx] [POSE:xxx] tags.
        // Only natural functions remain: blink, lip sync, eye tracking.

        // ══ Eye Saccades (natural micro-movements) ══════════════
        _saccadeTimer += dt;
        if (_saccadeTimer >= _nextSaccade) {
            _saccadeTimer = 0;
            _nextSaccade = 0.5 + Math.random() * 2;
            _saccadeTargetX = (Math.random() - 0.5) * 0.04;
            _saccadeTargetY = (Math.random() - 0.5) * 0.02;
        }
        _saccadeCurrentX += (_saccadeTargetX - _saccadeCurrentX) * 0.3;
        _saccadeCurrentY += (_saccadeTargetY - _saccadeCurrentY) * 0.3;

        // ══ Eye Tracking (mouse follow + saccades) ═══════════════
        if (_eyeBones.left || _eyeBones.right) {
            var eyeYaw = _mouseX * 0.15 + _saccadeCurrentX;
            var eyePitch = _mouseY * 0.08 + _saccadeCurrentY;
            if (_eyeBones.left) {
                _eyeBones.left.rotation.y += (eyeYaw - _eyeBones.left.rotation.y) * 0.1;
                _eyeBones.left.rotation.x += (eyePitch - _eyeBones.left.rotation.x) * 0.1;
            }
            if (_eyeBones.right) {
                _eyeBones.right.rotation.y += (eyeYaw - _eyeBones.right.rotation.y) * 0.1;
                _eyeBones.right.rotation.x += (eyePitch - _eyeBones.right.rotation.x) * 0.1;
            }
        } else {
            // Fallback: morph-based eye direction
            setMorph('eyeLookOutLeft', Math.max(0, _mouseX * 0.3));
            setMorph('eyeLookInLeft', Math.max(0, -_mouseX * 0.3));
            setMorph('eyeLookOutRight', Math.max(0, -_mouseX * 0.3));
            setMorph('eyeLookInRight', Math.max(0, _mouseX * 0.3));
            setMorph('eyeLookUpLeft', Math.max(0, _mouseY * 0.2));
            setMorph('eyeLookUpRight', Math.max(0, _mouseY * 0.2));
            setMorph('eyeLookDownLeft', Math.max(0, -_mouseY * 0.2));
            setMorph('eyeLookDownRight', Math.max(0, -_mouseY * 0.2));
        }

        // Body stays STILL — only brain-triggered gestures move the model
        // (via updateGesture which is already called above)
        if (currentModel && !isPresenting && !isAttentive && !activeGesture) {
            // Return to neutral standing position (no sway, no lean)
            currentModel.rotation.y += (0 - currentModel.rotation.y) * 0.05;
            currentModel.rotation.x += (0 - currentModel.rotation.x) * 0.05;
        } else if (currentModel && isPresenting) {
            currentModel.rotation.y += (-PRESENT_ANGLE - currentModel.rotation.y) * 0.08;
        } else if (currentModel && isAttentive) {
            currentModel.rotation.y += (_mouseX * 0.04 - currentModel.rotation.y) * 0.05;
        }
        // SMOOTH mouth close — exponential decay instead of instant zero
        var _lipRan = (lipSync && window.KVoice && KVoice.isSpeaking());
        if (!_lipRan) {
            for (var ci = 0; ci < _mouthMorphCache.length; ci++) {
                var curr = _mouthMorphCache[ci].mesh.morphTargetInfluences[_mouthMorphCache[ci].idx];
                _mouthMorphCache[ci].mesh.morphTargetInfluences[_mouthMorphCache[ci].idx] = curr * 0.85;
            }
        }
        renderer.render(scene, camera);
    }

    function onResize() {
        var canvas = document.getElementById('avatar-canvas');
        if (!canvas || !renderer) return;
        var container = canvas.parentElement;
        var w = container.clientWidth;
        var h = container.clientHeight;
        if (w === 0 || h === 0) return;
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
        setPose: setPose,
        findArmBones: findArmBones,
        getLipSync: function () { return lipSync; },
        getTextLipSync: function () { return textLipSync; },
        getMorphMeshes: function () { return morphMeshes; },
        onResize: onResize
    };
})();
