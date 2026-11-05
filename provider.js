/// <reference path="./manga-provider.d.ts" />

/**
 * Baka-Tsuki Light Novels, a Seanime "manga provider" that renders novel text as image pages.
 *
 * Seanime has no native novel type, so:
 *   - each light novel series  -> a "manga"
 *   - each chapter/section     -> a "chapter"
 *   - each chapter page        -> an SVG image (data URI) containing wrapped text
 */
class Provider {
    api = "https://www.baka-tsuki.org/project/api.php"

    // ---- page rendering settings ----
    pageWidth = 900
    pageHeight = 1300
    margin = 70
    fontSize = 26
    lineHeight = 40
    maxChars = 56 // characters per line (rough, tuned for serif @ 26px)

    getSettings() {
        return {
            supportsMultiLanguage: false,
            supportsMultiScanlator: false,
        }
    }

    // ------------------------------------------------------------------ search
    async search(opts) {
        const url = `${this.api}?action=query&list=search&srnamespace=0&srlimit=20&format=json&srsearch=${encodeURIComponent(opts.query)}`
        const data = await (await fetch(url)).json()
        const hits = (data && data.query && data.query.search) || []

        const results = []
        for (const hit of hits) {
            const title = hit.title
            // Series pages are top-level; volume pages look like "Series:Volume 1"
            if (title.includes(":") || title.includes("/")) continue
            results.push({
                id: title,
                title: title.replace(/_/g, " ").replace(/\s*\(.*?\)\s*$/, ""),
                synonyms: [],
                year: undefined,
                image: undefined,
            })
        }
        return results
    }

    // ---------------------------------------------------------------- chapters
    async findChapters(id) {
        const seriesUrl = `${this.api}?action=parse&prop=links&format=json&redirects=1&page=${encodeURIComponent(id)}`
        const series = await (await fetch(seriesUrl)).json()
        const links = (series && series.parse && series.parse.links) || []

        const prefix = id.replace(/_/g, " ") + ":"
        const seen = {}
        const volumes = []
        for (const l of links) {
            const t = l["*"]
            if (l.ns !== 0 || !t || seen[t]) continue
            if (t.startsWith(prefix)) {
                seen[t] = true
                volumes.push(t)
            }
        }

        // Fetch the section list of every volume in parallel
        const perVolume = await Promise.all(
            volumes.map(async (vol, vIdx) => {
                try {
                    const u = `${this.api}?action=parse&prop=sections&format=json&redirects=1&page=${encodeURIComponent(vol)}`
                    const d = await (await fetch(u)).json()
                    const sections = ((d && d.parse && d.parse.sections) || []).filter(
                        (s) => s.toclevel === 1 && !/^(Illustrations?|Notes?|Footnotes?|Translator|Contents?|Navigation)/i.test(s.line.trim()),
                    )
                    return { vol, vIdx, sections }
                } catch (e) {
                    return { vol, vIdx, sections: [] }
                }
            }),
        )

        const chapters = []
        let counter = 0
        for (const { vol, vIdx, sections } of perVolume) {
            const volLabel = vol.substring(prefix.length).trim() || `Volume ${vIdx + 1}`
            for (const s of sections) {
                counter++
                chapters.push({
                    provider: "bakatsuki-ln",
                    id: `${vol}||${s.index}`,
                    url: `https://www.baka-tsuki.org/project/index.php?title=${encodeURIComponent(vol.replace(/ /g, "_"))}`,
                    title: `${volLabel} - ${this.stripTags(s.line)}`,
                    chapter: String(counter),
                    index: counter - 1,
                    language: "en",
                })
            }
        }
        return chapters
    }

    // ------------------------------------------------------------------- pages
    async findChapterPages(id) {
        const [vol, sectionIndex] = id.split("||")
        const url = `${this.api}?action=parse&prop=text&format=json&redirects=1&disableeditsection=1&page=${encodeURIComponent(vol)}&section=${encodeURIComponent(sectionIndex)}`
        const data = await (await fetch(url)).json()
        const html = (data && data.parse && data.parse.text && data.parse.text["*"]) || ""

        const text = this.htmlToText(html)
        const lines = this.wrap(text)
        const perPage = Math.floor((this.pageHeight - this.margin * 2) / this.lineHeight)

        const pages = []
        for (let i = 0, p = 0; i < lines.length; i += perPage, p++) {
            const svg = this.renderSvg(lines.slice(i, i + perPage), p + 1)
            pages.push({
                url: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
                index: p,
                headers: {},
            })
        }
        return pages
    }

    // ----------------------------------------------------------------- helpers
    htmlToText(html) {
        return this.decode(
            html
                .replace(/<(script|style|table)[\s\S]*?<\/\1>/gi, "")
                .replace(/<div class="thumb[\s\S]*?<\/div>\s*<\/div>/gi, "") // images/captions
                .replace(/<br\s*\/?>/gi, "\n")
                .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
                .replace(/<[^>]+>/g, ""),
        )
            .replace(/\[\d+\]/g, "") // footnote markers
            .replace(/\n{3,}/g, "\n\n")
            .trim()
    }

    stripTags(s) {
        return this.decode(s.replace(/<[^>]+>/g, "")).trim()
    }

    decode(s) {
        return s
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#0?39;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    }

    wrap(text) {
        const out = []
        for (const para of text.split("\n")) {
            if (!para.trim()) {
                out.push("")
                continue
            }
            let line = ""
            for (const word of para.split(/\s+/)) {
                if ((line + " " + word).trim().length > this.maxChars) {
                    out.push(line)
                    line = word
                } else {
                    line = (line + " " + word).trim()
                }
            }
            if (line) out.push(line)
        }
        return out
    }

    escapeXml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }

    renderSvg(lines, pageNo) {
        const w = this.pageWidth
        const h = this.pageHeight
        let y = this.margin + this.fontSize
        const tspans = lines
            .map((l) => {
                const el = `<text x="${this.margin}" y="${y}">${this.escapeXml(l)}</text>`
                y += this.lineHeight
                return el
            })
            .join("")
        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
            `<rect width="100%" height="100%" fill="#faf6ee"/>` +
            `<g font-family="Georgia, 'Times New Roman', serif" font-size="${this.fontSize}" fill="#1c1c1c">${tspans}</g>` +
            `<text x="${w / 2}" y="${h - 30}" font-size="16" fill="#888" text-anchor="middle" font-family="sans-serif">${pageNo}</text>` +
            `</svg>`
        )
    }
}
