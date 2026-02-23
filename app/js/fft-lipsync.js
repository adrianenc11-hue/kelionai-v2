// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Simple Lip Sync
// Uses Smile morph (what's available in the model)
// Simple: audio energy → mouth open, silence → mouth closed
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var morphMeshes = [];
    var audioCtx = null;
    var analyser = null;
    var sourceNode = null;
    var dataArray = null;
    var animFrame = null;
    var isRunning = false;

    // Morph targets that control mouth (try all known names)
    var MOUTH_MORPHS = ['Smile', 'jawOpen', 'mouthOpen', 'viseme_aa', 'JawOpen', 'mouth_open'];

    function SimpleLipSync() { }

    SimpleLipSync.prototype.setMorphMeshes = function (meshes) {
        morphMeshes = meshes;
    };

    SimpleLipSync.prototype.connectToElement = function (audioEl) {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            // Don't create multiple sources for same element
            if (sourceNode) {
                try { sourceNode.disconnect(); } catch (e) { }
            }

            sourceNode = audioCtx.createMediaElementSource(audioEl);
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.7;

            sourceNode.connect(analyser);
            analyser.connect(audioCtx.destination);

            dataArray = new Uint8Array(analyser.frequencyBinCount);
            return true;
        } catch (e) {
            console.error('[LipSync] Connect error:', e);
            return false;
        }
    };

    SimpleLipSync.prototype.start = function () {
        if (isRunning) return;
        isRunning = true;

        var self = this;
        function tick() {
            if (!isRunning) return;
            animFrame = requestAnimationFrame(tick);

            if (!analyser || !dataArray) return;
            analyser.getByteFrequencyData(dataArray);

            // Calculate average energy (voice frequencies 100-3000Hz range)
            var sum = 0;
            var count = 0;
            // Focus on voice range bins (skip bass, skip very high freq)
            var startBin = 2;  // ~200Hz
            var endBin = Math.min(dataArray.length, 40); // ~3000Hz
            for (var i = startBin; i < endBin; i++) {
                sum += dataArray[i];
                count++;
            }
            var avg = count > 0 ? sum / count : 0;

            // Normalize to 0-1 with sensitivity
            var mouthOpen = Math.min(1, Math.max(0, (avg - 20) / 80));

            // Apply to all mouth morphs found in the model
            self._setMouth(mouthOpen);
        }
        tick();
    };

    SimpleLipSync.prototype.stop = function () {
        isRunning = false;
        if (animFrame) cancelAnimationFrame(animFrame);
        animFrame = null;
        this._setMouth(0); // Close mouth
    };

    SimpleLipSync.prototype._setMouth = function (value) {
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var i = 0; i < MOUTH_MORPHS.length; i++) {
                var idx = mesh.morphTargetDictionary[MOUTH_MORPHS[i]];
                if (idx !== undefined) {
                    mesh.morphTargetInfluences[idx] = value;
                }
            }
        }
    };

    SimpleLipSync.prototype.dispose = function () {
        this.stop();
        if (sourceNode) try { sourceNode.disconnect(); } catch (e) { }
        sourceNode = null;
        analyser = null;
    };

    // ─── Text-based lip sync (no audio needed) ───────────────
    function TextLipSync(opts) {
        this.msPerChar = (opts && opts.msPerChar) || 55;
        this.timer = null;
        this.charIndex = 0;
        this.text = '';
    }

    TextLipSync.prototype.setMorphMeshes = function (meshes) {
        morphMeshes = meshes;
    };

    TextLipSync.prototype.speak = function (text) {
        this.stop();
        this.text = text;
        this.charIndex = 0;
        var self = this;

        function tick() {
            if (self.charIndex >= self.text.length) {
                self.stop();
                return;
            }

            var ch = self.text[self.charIndex].toLowerCase();
            var isVowel = 'aeiouăâîșț'.indexOf(ch) >= 0;
            var isConsonant = ch >= 'a' && ch <= 'z' && !isVowel;

            var mouthVal = 0;
            if (isVowel) mouthVal = 0.5 + Math.random() * 0.3;
            else if (isConsonant) mouthVal = 0.15 + Math.random() * 0.2;
            // space/punctuation = 0 (mouth almost closed)

            SimpleLipSync.prototype._setMouth(mouthVal);
            self.charIndex++;
            self.timer = setTimeout(tick, self.msPerChar);
        }
        tick();
    };

    TextLipSync.prototype.stop = function () {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        SimpleLipSync.prototype._setMouth(0);
    };

    window.SimpleLipSync = SimpleLipSync;
    window.TextLipSync = TextLipSync;

    // Keep backward compat
    window.FFTLipSync = SimpleLipSync;
})();
