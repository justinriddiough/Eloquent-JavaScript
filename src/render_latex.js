let fs = require("fs")
let {transformTokens} = require("./transform")

let file, noStarch = false
for (let arg of process.argv.slice(2)) {
  if (arg == "--nostarch") noStarch = true
  else if (file) throw new Error("Multiple input files")
  else file = arg == "-" ? "/dev/stdin" : arg
}
if (!file) throw new Error("No input file")
let chapter = /^\d{2}_([^\.]+)/.exec(file) || [null, "hints"]

let {tokens, metadata} = transformTokens(require("./markdown").parse(fs.readFileSync(file, "utf8"), {}), {
  defined: ["book", "tex"],
  strip: "hints",
  texQuotes: true,
  capitalizeTitles: noStarch,
  index: true
})

let chapters = fs.readdirSync(__dirname + "/..")
    .filter(file => /^\d{2}_\w+\.md$/.test(file))
    .sort()
    .map(file => /^\d{2}_(\w+)\.md$/.exec(file)[1])

function escapeChar(ch) {
  switch (ch) {
    case "~": return "\\textasciitilde "
    case "^": return "\\textasciicircum "
    case "\\": return "\\textbackslash "
    default: return "\\" + ch
  }
}
function escape(str) { return str.replace(/[&%$#_{}~^\\]/g, escapeChar) }
function miniEscape(str) { return str.replace(/[`]/g, escapeChar) }

function escapeIndex(value) {
  if (Array.isArray(value)) return value.map(escape).join("!")
  return escape(String(value))
}

function highlight(lang, text) {
  if (lang == "html") lang = "text/html"
  let result = ""
  CodeMirror.runMode(text, lang, (text, style) => {
    let esc = escape(text)
    result += style ? `<span class="${style.replace(/^|\s+/g, "$&cm-")}">${esc}</span>` : esc
  })
  return result
}

function anchor(token) {
  return token.hashID ? `<a class="${token.hashID.charAt(0)}_ident" id="${token.hashID}" href="#${token.hashID}"></a>` : ""
}

function id(token) {
  let id = token.attrGet("id")
  return id ? `\\label{${chapter[1] + "." + id}}` : ''
}

let linkedChapter = null, raw = false, quote = false

let renderer = {
  fence(token) {
    if (/\bhidden:\s*true/.test(token.info)) return ""
    return `\n\n${id(token)}\\begin{lstlisting}\n${token.content.trimRight()}\n\\end{lstlisting}\n\\noindent`
  },

  hardbreak() { return "\\break\n" },
  softbreak() { return " " },

  text(token) {
    let {content} = token
    if (linkedChapter != null) content = content.replace(/\?/g, linkedChapter)
    return raw ? content : escape(content)
  },

  paragraph_open(token) {
    let nl = "\n\n";
    if (quote) { nl = ""; quote = false }
    return nl + id(token)
  },
  paragraph_close() { return "" },

  heading_open(token) {
    if (token.tag == "h1") return `\\label{${chapter[1]}}\\chapter${/^00/.test(file) ? "*" : ""}{`
    if (token.tag == "h2") return `\n\n${id(token)}\\section{`
    if (token.tag == "h3") return `\n\n${id(token)}\\subsection{`
    if (token.tag == "h4") return `\n\n${id(token)}\\subsubsection{`
    throw new Error("Can't handle heading tag " + token.tag)
  },
  heading_close(token) { return `}` },

  bullet_list_open(token) { return `\n\n\\begin{itemize}` },
  bullet_list_close() { return `\n\\end{itemize}` },

  ordered_list_open(token) { return `\n\n\\begin{enumerate}` },
  ordered_list_close() { return `\n\\end{enumerate}` },

  list_item_open() { return `\n\\item ` },
  list_item_close() { return "" },

  table_open() { return `\n\n\\noindent\\begin{tabular}{ll}` },
  table_close() { return `\n\\end{tabular}` },
  tbody_open() { return "" },
  tbody_close() { return "" },
  tr_open() { return "" },
  tr_close() { return "\n\\tabularnewline" },
  td_open() { return "\n" },
  td_close(_, next) { return next && next.type == "td_open" ? " &" : "" },

  code_inline(token) { return `\\lstinline\`${miniEscape(token.content)}\`` },

  strong_open() { return "\\textbf{" },
  strong_close() { return "}" },

  em_open() { return "\\emph{" },
  em_close() { return "}" },

  sub_open() { return "\\textsubscript{" },
  sub_close() { return "}" },

  sup_open() { return "\\textsuperscript{" },
  sup_close() { return "}" },

  meta_indexsee(token) {
    return `\\index{${escapeIndex(token.args[0])}|see{${escapeIndex(token.args[1])}}}`
  },
  meta_index(token) {
    return token.args.map(term => `\\index{${escapeIndex(term)}}`).join("")
  },

  meta_latex_open() { raw = true; return "" },
  meta_latex_close() { raw = false; return "" },

  link_open(token) {
    let href= token.attrGet("href")
    let maybeChapter = /^(\w+)(?:#(.*))?$/.exec(href)
    if (!maybeChapter || !chapters.includes(maybeChapter[1])) return `\\href{${href}}{`
    linkedChapter = chapters.indexOf(maybeChapter[1])
    return `\\hyperref[${maybeChapter[1] + (maybeChapter[2] ? "." + maybeChapter[2] : "")}]{`
  },
  link_close() { linkedChapter = null; return "}" },

  inline(token) { return renderArray(token.children) },

  meta_figure(token) {
    let {url, width} = token.args[0]
    if (/\.svg$/.test(url)) url = url.replace(/^img\//, "img/generated/").replace(/\.svg$/, ".pdf")
    return `\n\n\\vskip 1.5ex\n\\includegraphics[width=${width || "10cm"}]{${url}}\n\\vskip 1.5ex`
  },

  meta_quote_open(token) {
    if (token.args[0] && token.args[0].chapter) {
      quote = true
      return `\n\n\\epigraphhead[30]{\n\\epigraph{\\hspace*{-.1cm}\\itshape\`\``
    } else {
      return `\n\n\\begin{quote}`
    }
  },
  meta_quote_close(token) {
    quote = false
    let {author, title, chapter} = token.args[0] || {}
    let attribution = author ? `\n{---${escape(author)}${title ? `, ${escape(title)}` : ""}}` : ""
    if (chapter)
      return `''}%${attribution}\n}`
    else
      return `${attribution}\n\\end{quote}`
  },

  meta_hint_open() { return "" }, // FIXME filter out entirely
  meta_hint_close() { return "" }
}

function renderArray(tokens) {
  let result = ""
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i], f = renderer[token.type]
    if (!f) throw new Error("No render function for " + token.type)
    result += f(token, tokens[i + 1])
  }
  return result
}

console.log(renderArray(tokens))
