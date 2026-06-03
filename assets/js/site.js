/* Site cascade: header → hero → sections, top-down on load, scroll-revealed below the fold. */
(function () {
	'use strict';

	const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	if (reduced) {
		// Skip animation entirely; reveal everything at once.
		document.querySelectorAll('header.top, section.s, main.page, article.post')
			.forEach(el => el.classList.add('in'));
		return;
	}

	// 1. Header in as soon as DOM is ready (and before the hero animation starts).
	function showHeader() {
		document.querySelectorAll('header.top').forEach(el => el.classList.add('in'));
	}
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', showHeader);
	} else {
		showHeader();
	}

	// 2. Section reveal observer. Each target gets `.in` when it enters view.
	//    Targets that are already in view at observer start fire immediately,
	//    sorted top-to-bottom and staggered so the cascade feels intentional.
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
				setTimeout(() => e.target.classList.add('in'), i * 280);
			});
		}, {
			rootMargin: '0px 0px -8% 0px',
			threshold: 0.05,
		});

		document.querySelectorAll('section.s, main.page, article.post')
			.forEach(el => observer.observe(el));
	}

	// 3. Trigger timing:
	//    - On the homepage (which has the hero canvas), wait for `hero-done`
	//      so the section cascade reads as a continuation of the hero build.
	//    - On other pages, start after a short delay so the header settles first.
	//    - Failsafe: start anyway after 5s in case `hero-done` never fires.
	if (document.querySelector('#wordmark')) {
		window.addEventListener('hero-done', startObserver, { once: true });
		setTimeout(startObserver, 5000);
	} else {
		setTimeout(startObserver, 400);
	}
})();
