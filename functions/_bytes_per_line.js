// 各語言平均每行 bytes 數的查表（自抽樣 + 社群常見估算）
// 用來把 GitHub /languages API 回傳的 bytes 換算成近似行數。
// 誤差 ±15% 左右，足夠看大略規模。
// 沒列在表裡的語言用 DEFAULT。

export const BYTES_PER_LINE = {
  // === Backend ===
  "Python": 30,
  "Ruby": 25,
  "Go": 25,
  "Rust": 28,
  "Java": 35,
  "Kotlin": 32,
  "Scala": 32,
  "C": 25,
  "C++": 28,
  "C#": 32,
  "Objective-C": 32,
  "Swift": 30,
  "PHP": 30,
  "Perl": 28,
  "Elixir": 28,
  "Erlang": 28,
  "Haskell": 30,
  "Clojure": 28,
  "OCaml": 32,
  "F#": 30,
  "Dart": 30,
  "Lua": 25,
  "Julia": 28,
  "R": 28,
  "Crystal": 28,
  "Nim": 28,
  "Zig": 28,
  "V": 28,
  // === Frontend ===
  "JavaScript": 28,
  "TypeScript": 30,
  "JSX": 30,
  "TSX": 32,
  "Vue": 35,
  "Svelte": 30,
  "HTML": 50,
  "CSS": 35,
  "SCSS": 35,
  "Sass": 30,
  "Less": 35,
  "Stylus": 30,
  // === Mobile ===
  "Objective-C++": 32,
  // === Shell / Config ===
  "Shell": 30,
  "Bash": 30,
  "Zsh": 30,
  "Fish": 30,
  "PowerShell": 32,
  "Batchfile": 28,
  "Makefile": 25,
  "CMake": 28,
  "Dockerfile": 30,
  // === Data ===
  "JSON": 45,
  "YAML": 40,
  "TOML": 35,
  "XML": 50,
  "INI": 28,
  "CSV": 40,
  // === Docs ===
  "Markdown": 60,
  "reStructuredText": 50,
  "TeX": 40,
  "AsciiDoc": 50,
  // === Embedded / Hardware ===
  "Arduino": 28,
  "Assembly": 22,
  "Verilog": 28,
  "VHDL": 32,
  // === Misc ===
  "SQL": 35,
  "GraphQL": 32,
  "Protocol Buffer": 32,
  "Thrift": 32,
  "SVG": 80,
  "Vim Script": 25,
  "Emacs Lisp": 28,
  "Jupyter Notebook": 40,  // mostly JSON wrapping
};

export const DEFAULT_BYTES_PER_LINE = 30;

// 純資料 / 標記語言（要在 UI 上分開顯示「程式碼 vs 資料/文件」）
export const DATA_LANGS = new Set([
  "JSON", "YAML", "TOML", "XML", "CSV", "INI",
  "Markdown", "reStructuredText", "AsciiDoc",
  "SVG", "HTML", "CSS", "SCSS", "Sass", "Less", "Stylus",
  "Jupyter Notebook",
]);

export function bytesToLines(language, bytes) {
  const bpl = BYTES_PER_LINE[language] || DEFAULT_BYTES_PER_LINE;
  return Math.round(bytes / bpl);
}
