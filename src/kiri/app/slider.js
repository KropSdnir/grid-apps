/** Copyright Stewart Allen <sa@grid.space> -- All Rights Reserved */

/**
 * Layer Slider Controller (Singleton)
 * Manages layer range selection and visualization for slice/preview views
 */

class SliderControl {
    #layerLo = 0;
    #layerHi = 0;
    #layerMax = 0;
    #ui;
    #slider;
    #tracker;
    #mobile;
    #sliderBar;
    #sliderBar2;
    #drag = {};
    // end box inputs: true while the user has typed text that is not applied yet
    #dirty = { lo: false, hi: false };
    #repeat = { delay: undefined, timer: undefined };

    // Callbacks to replace event emissions
    #onLayerChange;
    #onStackUpdate;
    #onSceneUpdate;

    #initialized = false;

    /**
     * Initialize the slider with configuration
     * @param {Object} config
     * @param {Object} config.ui - UI element references
     * @param {HTMLElement} config.tracker - Drag tracker element
     * @param {boolean} config.mobile - Mobile device flag
     * @param {Function} config.onLayerChange - Called when layer range changes
     * @param {Function} config.onStackUpdate - Called to update stack visibility
     * @param {Function} config.onSceneUpdate - Called to refresh scene
     */
    init({ ui, tracker, mobile, onLayerChange, onStackUpdate, onSceneUpdate }) {
        if (this.#initialized) {
            throw new Error('Slider already initialized');
        }

        this.#ui = ui;
        this.#slider = ui.slider;
        this.#tracker = tracker;
        this.#mobile = mobile;
        this.#sliderBar = mobile ? 80 : 30;
        this.#sliderBar2 = this.#sliderBar * 2;
        this.#onLayerChange = onLayerChange;
        this.#onStackUpdate = onStackUpdate;
        this.#onSceneUpdate = onSceneUpdate;

        this.#setupUI();
        this.#bindEvents();
        this.#initialized = true;

        return this;
    }

    /**
     * Get current layer range
     * @returns {{lo: number, hi: number, max: number}}
     */
    getRange() {
        return {
            lo: this.#layerLo,
            hi: this.#layerHi,
            max: this.#layerMax
        };
    }

    /**
     * Set layer range (bounds are enforced)
     * @param {number} lo - Lower layer
     * @param {number} hi - Upper layer
     * @param {boolean} notify - Whether to trigger callbacks (default: true)
     */
    setRange(lo, hi, notify = true) {
        this.#layerLo = Math.max(0, Math.min(hi, lo));
        this.#layerHi = Math.max(this.#layerLo, Math.min(this.#layerMax, hi));
        this.#updateVisuals();
        this.showLabels();
        if (notify) {
            this.#notifyChange();
        }
    }

    /**
     * Set maximum layer count
     * @param {number} max - Maximum layer value
     */
    setMax(max) {
        this.#layerMax = max;
        this.#slider.loIn.max = max;
        this.#slider.hiIn.max = max;
        if (max < this.#layerHi) {
            this.#layerHi = max;
            this.#updateVisuals();
        }
        this.showLabels();
    }

    /**
     * Update slider visual position from normalized values
     * @param {number} startPercent - Start position (0-1)
     * @param {number} endPercent - End position (0-1)
     */
    updatePosition(startPercent, endPercent) {
        const width = this.#slider.range.clientWidth;
        const maxval = Math.max(0, width - this.#sliderBar2);
        const start = Math.max(0, Math.min(1, startPercent));
        const end = Math.max(start, Math.min(1, endPercent));

        const lowval = start * maxval;
        const midval = ((end - start) * maxval) + this.#sliderBar;
        const hival = maxval - end * maxval;

        this.#slider.hold.style.marginLeft = `${lowval}px`;
        this.#slider.mid.style.width = `${midval}px`;
        this.#slider.hold.style.marginRight = `${hival}px`;
    }

    /**
     * Show layer number labels
     */
    showLabels() {
        const digits = Math.max(2, this.#layerMax.toString().length) + 1;
        const { loIn, hiIn, loDec, loInc, hiDec, hiInc } = this.#slider;
        loIn.style.width = hiIn.style.width = `${digits}ch`;
        // never overwrite text the user is still typing
        if (!this.#dirty.lo) loIn.value = this.#layerLo;
        if (!this.#dirty.hi) hiIn.value = this.#layerHi;
        // the ends never cross, so a step that would cross is disabled
        loDec.disabled = this.#layerLo <= 0;
        loInc.disabled = this.#layerLo >= this.#layerHi;
        hiDec.disabled = this.#layerHi <= this.#layerLo;
        hiInc.disabled = this.#layerHi >= this.#layerMax;
    }

    /**
     * Move one end of the range by a number of layers (used by the < > buttons and arrow keys).
     * The ends never cross: low stays in 0..hi, high stays in lo..max.
     * @param {'lo'|'hi'} which - Which end to move
     * @param {number} delta - Layers to add (negative to subtract)
     * @returns {boolean} true if the range changed
     */
    step(which, delta) {
        return this.#apply(which, (which === 'lo' ? this.#layerLo : this.#layerHi) + delta, false);
    }

    /**
     * Set one end of the range to a typed value.
     * The value is rounded and clamped to 0..max. If it would cross the other end,
     * the other end is pushed along so the typed number is always the one shown.
     * @param {'lo'|'hi'} which - Which end to set
     * @param {number} value - Requested layer
     * @returns {boolean} true if the range changed
     */
    setEnd(which, value) {
        return this.#apply(which, value, true);
    }

    #apply(which, value, push) {
        if (!Number.isFinite(value)) {
            this.showLabels();
            return false;
        }
        value = Math.max(0, Math.min(this.#layerMax, Math.round(value)));
        let lo = this.#layerLo;
        let hi = this.#layerHi;
        if (which === 'lo') {
            if (push) hi = Math.max(hi, value);
            lo = Math.min(value, hi);
        } else {
            if (push) lo = Math.min(lo, value);
            hi = Math.max(value, lo);
        }
        const changed = lo !== this.#layerLo || hi !== this.#layerHi;
        if (changed) {
            this.setRange(lo, hi);
        } else {
            this.showLabels();
        }
        return changed;
    }

    /**
     * Show slider UI
     */
    show() {
        this.#ui.layers.style.display = 'flex';
        this.#slider.div.style.display = 'flex';
    }

    /**
     * Hide slider UI
     */
    hide() {
        this.#ui.layers.style.display = 'none';
        this.#slider.div.style.display = 'none';
    }

    #setupUI() {
        if (this.#mobile) {
            this.#slider.div.classList.add('slider-mobile');
            this.#slider.lo.classList.add('slider-mobile');
            this.#slider.hi.classList.add('slider-mobile');
        }
    }

    #bindEvents() {
        // < > buttons and editable number boxes at both ends
        const s = this.#slider;
        this.#bindEnd('lo', s.loDec, s.loIn, s.loInc);
        this.#bindEnd('hi', s.hiDec, s.hiIn, s.hiInc);

        // Mouse hover for labels
        this.#slider.div.onmouseover = () => {
            this.showLabels();
        };

        this.#slider.div.onmouseleave = (ev) => {
            if (!ev.buttons) {
                this.hideLabels();
            }
        };

        // Drag handlers for the three slider sections
        this.#bindDrag(this.#slider.lo, this.#handleLoDrag.bind(this));
        this.#bindDrag(this.#slider.mid, this.#handleMidDrag.bind(this));
        this.#bindDrag(this.#slider.hi, this.#handleHiDrag.bind(this));
    }

    #bindEnd(which, dec, input, inc) {
        this.#bindStepButton(which, dec, -1);
        this.#bindStepButton(which, inc, 1);

        // presses and wheel on the box must not reach the 3D view underneath
        for (const name of ['mousedown', 'touchstart', 'wheel']) {
            input.addEventListener(name, ev => ev.stopPropagation(), { passive: true });
        }
        // a focused number box would otherwise change value on wheel
        input.addEventListener('wheel', ev => {
            if (input.ownerDocument.activeElement === input) {
                ev.preventDefault();
            }
        }, { passive: false });

        const valid = txt => /^[-+]?\d+(\.\d+)?$/.test(txt);
        const commit = () => {
            const txt = input.value.trim();
            this.#dirty[which] = false;
            input.classList.remove('bad');
            if (valid(txt)) {
                this.setEnd(which, parseFloat(txt));
            } else {
                // empty or not a number: put the old value back
                this.showLabels();
            }
        };
        const revert = () => {
            this.#dirty[which] = false;
            input.classList.remove('bad');
            this.showLabels();
        };

        input.addEventListener('input', () => {
            this.#dirty[which] = true;
            const txt = input.value.trim();
            input.classList.toggle('bad', txt !== '' && !valid(txt));
        });
        input.addEventListener('change', commit);
        input.addEventListener('blur', () => {
            if (this.#dirty[which]) commit();
        });
        // click into the box selects the whole number so typing replaces it
        let fresh = false;
        input.addEventListener('focus', () => { fresh = true; input.select(); });
        input.addEventListener('mouseup', ev => {
            if (fresh) ev.preventDefault();
            fresh = false;
        });
        input.addEventListener('keydown', ev => {
            switch (ev.key) {
                case 'Enter':
                    ev.preventDefault();
                    commit();
                    input.select();
                    break;
                case 'Escape':
                    ev.preventDefault();
                    revert();
                    input.blur();
                    break;
                case 'ArrowUp':
                case 'ArrowDown':
                    ev.preventDefault();
                    if (this.#dirty[which]) commit();
                    this.step(which, ev.key === 'ArrowUp' ? 1 : -1);
                    input.select();
                    break;
            }
        });
    }

    /**
     * < / > button: one click is exactly one layer. Holding repeats after a delay.
     */
    #bindStepButton(which, btn, delta) {
        const stop = () => {
            clearTimeout(this.#repeat.delay);
            clearInterval(this.#repeat.timer);
            this.#repeat.delay = this.#repeat.timer = undefined;
        };
        btn.addEventListener('pointerdown', ev => {
            if (ev.button !== 0) return;
            ev.preventDefault(); // no focus change, no text selection
            ev.stopPropagation();
            stop();
            // apply a half-typed value first so the step starts from what is shown
            for (const [key, input] of [['lo', this.#slider.loIn], ['hi', this.#slider.hiIn]]) {
                if (this.#dirty[key]) input.dispatchEvent(new Event('change'));
            }
            try { btn.setPointerCapture(ev.pointerId); } catch (e) { }
            this.step(which, delta);
            this.#repeat.delay = setTimeout(() => {
                this.#repeat.timer = setInterval(() => {
                    if (!this.step(which, delta)) stop();
                }, 60);
            }, 400);
        });
        btn.addEventListener('pointerup', stop);
        btn.addEventListener('pointercancel', stop);
        btn.addEventListener('lostpointercapture', stop);
        btn.addEventListener('mousedown', ev => ev.stopPropagation());
        btn.addEventListener('touchstart', ev => ev.stopPropagation(), { passive: true });
        // keyboard activation (Enter/Space on a focused button) has no pointer press
        btn.addEventListener('click', ev => {
            if (ev.detail === 0) this.step(which, delta);
        });
    }

    #bindDrag(el, deltaHandler) {
        const slider = this.#slider.range;

        el.ontouchstart = el.onmousedown = (ev) => {
            this.#tracker.style.display = 'block';
            ev.stopPropagation();

            let obj = (ev.touches ? ev.touches[0] : ev);
            this.#drag.width = slider.clientWidth;
            this.#drag.maxval = this.#drag.width - this.#sliderBar2;
            this.#drag.start = obj.screenX;
            this.#drag.loat = this.#drag.low = this.#pxToInt(this.#slider.hold.style.marginLeft);
            this.#drag.mdat = this.#drag.mid = this.#slider.mid.clientWidth;
            this.#drag.hiat = this.#pxToInt(this.#slider.hold.style.marginRight);
            this.#drag.mdmax = this.#drag.width - this.#sliderBar - this.#drag.loat;
            this.#drag.himax = this.#drag.width - this.#sliderBar - this.#drag.mdat;

            const cancelDrag = this.#tracker.ontouchend = this.#tracker.onmouseup = (ev) => {
                if (ev) {
                    ev.stopPropagation();
                    ev.preventDefault();
                }
                slider.onmousemove = undefined;
                this.#tracker.style.display = 'none';
            };

            el.ontouchend = cancelDrag;
            el.ontouchmove = this.#tracker.ontouchmove = this.#tracker.onmousemove = (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                if (ev.buttons === 0) {
                    return cancelDrag();
                }
                if (deltaHandler) {
                    let obj = (ev.touches ? ev.touches[0] : ev);
                    deltaHandler(obj.screenX - this.#drag.start);
                }
            };
        };
    }

    #handleLoDrag(delta) {
        let midval = this.#drag.mdat - delta;
        let lowval = this.#drag.loat + delta;

        if (midval < this.#sliderBar || lowval < 0) {
            return;
        }

        this.#slider.hold.style.marginLeft = `${lowval}px`;
        this.#slider.mid.style.width = `${midval}px`;
        this.#drag.low = lowval;
        this.#drag.mid = midval;
        this.#updateFromDrag();
    }

    #handleMidDrag(delta) {
        let loval = this.#drag.loat + delta;
        let hival = this.#drag.hiat - delta;

        if (loval < 0 || hival < 0) {
            return;
        }

        this.#slider.hold.style.marginLeft = `${loval}px`;
        this.#slider.hold.style.marginRight = `${hival}px`;
        this.#drag.low = loval;
        this.#updateFromDrag();
    }

    #handleHiDrag(delta) {
        let midval = this.#drag.mdat + delta;
        let hival = this.#drag.hiat - delta;

        if (midval < this.#sliderBar || midval > this.#drag.mdmax || hival < 0) {
            return;
        }

        this.#slider.mid.style.width = `${midval}px`;
        this.#slider.hold.style.marginRight = `${hival}px`;
        this.#drag.mid = midval;
        this.#updateFromDrag();
    }

    #updateFromDrag() {
        const start = this.#drag.low / this.#drag.maxval;
        const end = (this.#drag.low + this.#drag.mid - this.#sliderBar) / this.#drag.maxval;

        this.#layerLo = Math.round(start * this.#layerMax);
        this.#layerHi = Math.round(end * this.#layerMax);

        this.showLabels();
        this.#notifyChange();
    }

    #updateVisuals() {
        if (this.#layerMax === 0) return;
        const start = this.#layerLo / this.#layerMax;
        const end = this.#layerHi / this.#layerMax;
        this.updatePosition(start, end);
    }

    #notifyChange() {
        // Notify callbacks of layer change
        this.#onLayerChange?.(this.#layerHi, this.#layerLo);
        this.#onStackUpdate?.(this.#layerLo, this.#layerHi);
        this.#onSceneUpdate?.();
    }

    #pxToInt(txt) {
        return txt ? parseInt(txt.substring(0, txt.length - 2)) : 0;
    }

    hideLabels() {
        // Labels hide themselves on mouse leave, but can be called explicitly
    }
}

// Export singleton instance
export const slider = new SliderControl();
