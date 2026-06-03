/* Site cascade + pixelized section headings.
   Header in → hero animation → sections cascade in.
   Each .s-head is rendered into a canvas using the same
   slide-from-edges + rise-from-floor effect as the hero,
   scaled down and triggered when its section enters view. */
(function () {
	'use strict';

	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (reduced) {
		document.querySelectorAll('header.top, section.s, main.page, article.post')
			.forEach(el => el.classList.add('in'));
		return;
	}

	/* ---- 1. Header reveal ---- */
	function showHeader() {
		document.querySelectorAll('header.top').forEach(el => el.classList.add('in'));
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', showHeader);
	} else {
		showHeader();
	}

	/* ---- 2. Pixelize a single canvas with given text ---- */
	function pixelize(canvas, text, opts) {
		opts = opts || {};
		const fontSize = opts.fontSize || 14;
		const fontWeight = opts.fontWeight || 500;
		const letterSpacingEm = opts.letterSpacingEm || 0;
		const color = opts.color || '#131418';
		const paddingX = opts.paddingX || 4;

		const ctx = canvas.getContext('2d');
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const family = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';
		const letterSpacing = fontSize * letterSpacingEm;

		const measure = document.createElement('canvas').getContext('2d');
		measure.font = `${fontWeight} ${fontSize}px ${family}`;
		const supportsLS = 'letterSpacing' in measure;
		let textW;
		if (supportsLS) {
			measure.letterSpacing = `${letterSpacing}px`;
			textW = measure.measureText(text).width;
		} else {
			let cursor = 0;
			for (const ch of text) {
				cursor += measure.measureText(ch).width + letterSpacing;
			}
			textW = cursor - letterSpacing;
		}

		const cssW = Math.ceil(textW + paddingX * 2);
		const cssH = Math.ceil(fontSize * 1.9);
		canvas.style.width = cssW + 'px';
		canvas.style.height = cssH + 'px';
		canvas.width = cssW * dpr;
		canvas.height = cssH * dpr;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		const off = document.createElement('canvas');
		off.width = cssW;
		off.height = cssH;
		const octx = off.getContext('2d');
		octx.font = `${fontWeight} ${fontSize}px ${family}`;
		octx.textBaseline = 'middle';
		octx.textAlign = 'left';
		octx.fillStyle = '#000';

		const yC = cssH * 0.42;
		if (supportsLS) {
			octx.letterSpacing = `${letterSpacing}px`;
			octx.fillText(text, paddingX, yC);
		} else {
			let cursor = paddingX;
			for (const ch of text) {
				octx.fillText(ch, cursor, yC);
				cursor += octx.measureText(ch).width + letterSpacing;
			}
		}

		const data = octx.getImageData(0, 0, cssW, cssH).data;
		const step = Math.max(2, Math.round(fontSize / 8));
		const dotSz = Math.max(1.5, Math.round(step * 0.6));

		const targets = [];
		for (let y = 0; y < cssH; y += step) {
			for (let x = 0; x < cssW; x += step) {
				const i = (y * cssW + x) * 4;
				if (data[i + 3] > 128) targets.push({ x: x + step / 2, y: y + step / 2 });
			}
		}

		if (targets.length === 0) {
			return { play: function () {} };
		}

		const maxY = targets.reduce((m, p) => Math.max(m, p.y), 0);
		const floor = Math.min(cssH - 2, maxY + Math.max(step * 2, 8));

		const ys = targets.map(p => p.y);
		const minTY = Math.min.apply(null, ys);
		const maxTY = Math.max.apply(null, ys);
		const span = Math.max(maxTY - minTY, 1);

		const dots = targets.map(p => {
			const left = p.x < cssW / 2;
			const margin = 16 + Math.random() * 50;
			const sx = left ? -margin : cssW + margin;
			const slide = Math.abs(p.x - sx);
			const fromBottom = (maxTY - p.y) / span;
			return {
				tx: p.x, ty: p.y, sx, size: dotSz,
				dSlide: fromBottom * 200 + Math.random() * 100,
				tSlide: 280 + slide * 1.6 + Math.random() * 90,
				tRise: 220 + (floor - p.y) * 1.2 + Math.random() * 40,
			};
		});

		// Re-draws the clean text into the visible canvas using the exact
		// same font/baseline/coordinates used when sampling. Result lands
		// pixel-perfectly on top of where the assembled dots sat.
		function drawText(targetCtx) {
			targetCtx.font = `${fontWeight} ${fontSize}px ${family}`;
			targetCtx.textBaseline = 'middle';
			targetCtx.textAlign = 'left';
			targetCtx.fillStyle = color;
			if (supportsLS) {
				targetCtx.letterSpacing = `${letterSpacing}px`;
				targetCtx.fillText(text, paddingX, yC);
			} else {
				let cursor = paddingX;
				for (const ch of text) {
					targetCtx.fillText(ch, cursor, yC);
					cursor += targetCtx.measureText(ch).width + letterSpacing;
				}
			}
		}

		let raf = null;
		let t0 = 0;
		function easeOutQuart(t) { return 1 - Math.pow(1 - t, 4); }
		function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

		const TRANSITION_MS = 380;
		const TRANSITION_DELAY = 80;

		function morph(now, morphStart) {
			const t = Math.min(1, (now - morphStart) / TRANSITION_MS);
			ctx.clearRect(0, 0, cssW, cssH);

			// Particles fading out
			ctx.globalAlpha = 1 - t;
			ctx.fillStyle = color;
			for (const d of dots) {
				ctx.fillRect(d.tx - d.size / 2, d.ty - d.size / 2, d.size, d.size);
			}

			// Clean text fading in (same position, identical coordinates)
			ctx.globalAlpha = t;
			drawText(ctx);

			ctx.globalAlpha = 1;

			if (t < 1) {
				raf = requestAnimationFrame((n) => morph(n, morphStart));
			} else {
				ctx.clearRect(0, 0, cssW, cssH);
				drawText(ctx);
				if (onDoneCb) { const cb = onDoneCb; onDoneCb = null; cb(); }
			}
		}

		function frame(now) {
			const el = now - t0;
			ctx.clearRect(0, 0, cssW, cssH);
			ctx.fillStyle = color;
			let busy = false;
			for (const d of dots) {
				const lt = el - d.dSlide;
				if (lt < 0) { busy = true; continue; }

				if (lt < d.tSlide) {
					busy = true;
					const t = lt / d.tSlide;
					const e = easeOutQuart(t);
					const x = d.sx + (d.tx - d.sx) * e;
					ctx.fillRect(x - d.size / 2, floor - d.size / 2, d.size, d.size);
					continue;
				}

				const rt = lt - d.tSlide;
				if (rt < d.tRise) {
					busy = true;
					const t = rt / d.tRise;
					const e = easeOutCubic(t);
					const y = floor + (d.ty - floor) * e;
					ctx.fillRect(d.tx - d.size / 2, y - d.size / 2, d.size, d.size);
					continue;
				}

				ctx.fillRect(d.tx - d.size / 2, d.ty - d.size / 2, d.size, d.size);
			}

			if (busy) {
				raf = requestAnimationFrame(frame);
			} else {
				// Particles done — kick off the in-canvas morph to clean text.
				const morphStart = performance.now() + TRANSITION_DELAY;
				raf = requestAnimationFrame(function wait(n) {
					if (n < morphStart) raf = requestAnimationFrame(wait);
					else morph(n, morphStart);
				});
			}
		}

		let onDoneCb = null;
		return {
			play: function (onDone) {
				cancelAnimationFrame(raf);
				onDoneCb = onDone || null;
				t0 = performance.now();
				raf = requestAnimationFrame(frame);
			}
		};
	}

	/* ---- 3. Convert .s-head text → canvas ---- */
	const headInstances = new WeakMap();

	function setupSectionHeads() {
		document.querySelectorAll('.s-head').forEach(h => {
			const raw = (h.dataset.text || h.textContent || '').trim();
			if (!raw) return;
			const text = raw.toUpperCase();

			h.innerHTML = '';

			const canvas = document.createElement('canvas');
			canvas.setAttribute('aria-hidden', 'true');
			h.appendChild(canvas);

			const sr = document.createElement('span');
			sr.className = 'sr-only';
			sr.textContent = raw;
			h.appendChild(sr);

			const instance = pixelize(canvas, text, {
				fontSize: 14,
				fontWeight: 500,
				letterSpacingEm: 0.22,
				color: '#9b9ea4',
				paddingX: 4,
			});
			headInstances.set(h, instance);
		});
	}

	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(setupSectionHeads);
	} else {
		setTimeout(setupSectionHeads, 120);
	}

	/* ---- 4. Section reveal observer ---- */
	let started = false;
	function startObserver() {
		if (started) return;
		started = true;

		const observer = new IntersectionObserver((entries) => {
			const visible = entries
				.filter(e => e.isIntersecting)
				.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
			visible.forEach((e, i) => {
				observer.unobserve(e.target);
				setTimeout(() => {
					e.target.classList.add('in');
					const head = e.target.querySelector('.s-head');
					const instance = head ? headInstances.get(head) : null;
					if (instance) instance.play();
				}, i * 280);
			});
		}, {
			rootMargin: '0px 0px -8% 0px',
			threshold: 0.05,
		});

		document.querySelectorAll('section.s, main.page, article.post')
			.forEach(el => observer.observe(el));
	}

	if (document.querySelector('#wordmark')) {
		window.addEventListener('hero-done', startObserver, { once: true });
		setTimeout(startObserver, 5000);
	} else {
		setTimeout(startObserver, 400);
	}
})();
