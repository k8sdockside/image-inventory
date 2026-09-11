// Two drawings: a ring of shares (the registries), and a line chart for the
// plugin's Prometheus charts. Plain SVG, no library -- the page cannot load
// one from the network anyway, and these are a few dozen lines each.

import { add, el, svg } from './dom';

// ----- the ring ---------------------------------------------------------------------

export interface Slice {
    value: number;
    /** A CSS colour; custom properties are fine (it is set as a style). */
    colour: string;
    title: string;
}

/**
 * A ring with one arc per slice, largest first as given, a hairline gap
 * between them, and whatever `centre` holds written in the middle.
 */
export function ring(slices: Slice[], centre: Node, opts: { size?: number; thickness?: number; label?: string } = {}): HTMLElement {
    const size = opts.size ?? 184;
    const thickness = opts.thickness ?? 20;
    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;
    const wrap = el('div', 'ring');
    wrap.style.width = wrap.style.height = size + 'px';
    const drawing = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'ring-svg', role: 'img' });
    if (opts.label) drawing.setAttribute('aria-label', opts.label);
    drawing.appendChild(svg('circle', { cx: mid, cy: mid, r, class: 'ring-track', 'stroke-width': thickness }));

    const total = slices.reduce((n, s) => n + s.value, 0);
    const gap = slices.length > 1 ? Math.min(3, c / slices.length / 4) : 0;
    let offset = 0;
    for (const s of slices) {
        if (!total || s.value <= 0) continue;
        const length = (s.value / total) * c;
        const arc = svg('circle', {
            cx: mid,
            cy: mid,
            r,
            class: 'ring-arc',
            'stroke-width': thickness,
            'stroke-dasharray': `${Math.max(0.8, length - gap)} ${c}`,
            'stroke-dashoffset': String(-offset),
            transform: `rotate(-90 ${mid} ${mid})`,
        });
        arc.style.stroke = s.colour;
        const title = svg('title');
        title.textContent = s.title;
        arc.appendChild(title);
        drawing.appendChild(arc);
        offset += length;
    }
    const inner = el('div', 'ring-centre');
    inner.appendChild(centre);
    add(wrap, drawing, inner);
    return wrap;
}

// ----- line charts -------------------------------------------------------------------

/** Writes a value the way its unit reads. */
export function formatValue(v: number, unit: string): string {
    if (!Number.isFinite(v)) return '—';
    const round = (n: number): string => (Math.abs(n) >= 100 ? String(Math.round(n)) : Math.abs(n) >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/\.?0+$/, '') || '0');
    const bytes = (n: number): string => {
        const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
        let i = 0;
        while (Math.abs(n) >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return `${round(n)} ${units[i]}`;
    };
    switch (unit) {
        case 'count':
            return String(Math.round(v));
        case 'percent':
            return `${round(v * 100)}%`;
        case 'ops/s':
            return `${round(v)}/s`;
        case 'cores':
            return `${round(v)} cores`;
        case 'bytes':
            return bytes(v);
        case 'bytes/s':
            return `${bytes(v)}/s`;
        case 'seconds':
            return v < 120 ? `${round(v)}s` : v < 7200 ? `${round(v / 60)}m` : `${round(v / 3600)}h`;
        default:
            return round(v);
    }
}

export interface SeriesColour {
    /** The token, e.g. `--chart-1`. */
    token: string;
    fallback: string;
}

/**
 * The value of a theme token right now. SVG presentation attributes -- a
 * gradient's `stop-color` among them -- cannot hold `var()`, so a drawing that
 * needs a colour there asks for it here, and is drawn again when the theme
 * changes (see `k8sdockside.on('theme')` in the overview).
 */
export function tokenColour(c: SeriesColour): string {
    return getComputedStyle(document.documentElement).getPropertyValue(c.token).trim() || c.fallback;
}

let gradients = 0;

/**
 * One chart: a line per series from zero, a soft fill under it, a gap where
 * Prometheus had no sample, the top of the scale in the corner and each
 * series' latest value in the legend.
 */
export function lineChart(chart: K8sDockside.Chart, colourOf: (name: string, index: number) => SeriesColour): HTMLElement {
    const card = el('article', 'chart');
    const head = el('div', 'chart-head');
    head.appendChild(el('h3', '', chart.label));
    card.appendChild(head);
    if (chart.description) card.appendChild(el('p', 'chart-desc', chart.description));

    const series = chart.series.filter((s) => s.points.length > 0);
    if (chart.error || !series.length) {
        card.appendChild(el('p', 'quiet', chart.error ? chart.error : 'No data in this window.'));
        return card;
    }

    let minT = Infinity;
    let maxT = -Infinity;
    let maxV = 0;
    for (const s of series) {
        for (const p of s.points) {
            minT = Math.min(minT, p.t);
            maxT = Math.max(maxT, p.t);
            if (Number.isFinite(p.v)) maxV = Math.max(maxV, p.v);
        }
    }
    if (maxT === minT) maxT = minT + 1;
    const top = maxV > 0 ? maxV * 1.15 : 1;
    const W = 600;
    const H = 120;
    const x = (t: number): number => ((t - minT) / (maxT - minT)) * W;
    const y = (v: number): number => H - (Math.max(0, v) / top) * H;
    const step = (maxT - minT) / 60;

    const plot = el('div', 'chart-plot');
    const drawing = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'chart-svg', role: 'img' });
    drawing.setAttribute('aria-label', `${chart.label}: ${series.map((s) => `${s.name || chart.label} ${formatValue(s.points[s.points.length - 1]!.v, chart.unit)}`).join(', ')}`);
    const defs = svg('defs');
    drawing.appendChild(defs);
    for (const f of [0.25, 0.5, 0.75, 1]) {
        const gy = H * (1 - f / 1.15);
        drawing.appendChild(svg('line', { x1: 0, x2: W, y1: gy, y2: gy, class: 'chart-grid' }));
    }

    const legend = el('div', 'chart-legend');
    series.forEach((s, i) => {
        const colour = tokenColour(colourOf(s.name, i));
        const id = `fill-${++gradients}`;
        const gradient = svg('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
        gradient.appendChild(svg('stop', { offset: '0%', 'stop-color': colour, 'stop-opacity': 0.32 }));
        gradient.appendChild(svg('stop', { offset: '100%', 'stop-color': colour, 'stop-opacity': 0 }));
        defs.appendChild(gradient);

        // Runs of points with no gap longer than three steps between them.
        const runs: K8sDockside.ChartPoint[][] = [];
        let run: K8sDockside.ChartPoint[] = [];
        s.points.forEach((p, j) => {
            const prev = s.points[j - 1];
            if (!Number.isFinite(p.v) || (prev && p.t - prev.t > step * 3)) {
                if (run.length) runs.push(run);
                run = [];
                if (!Number.isFinite(p.v)) return;
            }
            run.push(p);
        });
        if (run.length) runs.push(run);

        for (const r of runs) {
            const d = r.map((p, j) => `${j ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
            const first = r[0]!;
            const last = r[r.length - 1]!;
            drawing.appendChild(svg('path', { d: `${d} L${x(last.t).toFixed(1)} ${H} L${x(first.t).toFixed(1)} ${H} Z`, fill: `url(#${id})`, class: 'chart-area' }));
            drawing.appendChild(svg('path', { d, stroke: colour, class: 'chart-line' }));
        }

        const latest = s.points[s.points.length - 1]!;
        const key = el('span', 'chart-key');
        const dot = el('i', 'dot');
        dot.style.background = colour;
        add(key, dot, el('span', '', s.name || chart.label), el('strong', '', formatValue(latest.v, chart.unit)));
        legend.appendChild(key);
    });

    add(plot, drawing, el('span', 'chart-top', formatValue(maxV, chart.unit)));
    add(card, plot, legend);
    return card;
}
