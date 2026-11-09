import { LatexTemplateProfileSchema, type LatexTemplateProfile } from '@featherduster/core';

const defaultProfile = Object.freeze(LatexTemplateProfileSchema.parse({
  id: 'default', name: 'Classic', format: 'latex',
  preamble: String.raw`\documentclass[letterpaper,10pt]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[margin=0.6in]{geometry}
\pagestyle{empty}
\setlength{\parindent}{0pt}`,
  body: '{{profile}}\n{{summary}}\n{{experiences}}\n{{education}}\n{{skills}}',
}));
const careerProfile = Object.freeze(LatexTemplateProfileSchema.parse({ id: "career-signature", name: "Career Signature", format: "latex", preamble: "\\documentclass[letterpaper,11pt]{article}\r\n\r\n\\usepackage{latexsym}\r\n\\usepackage[empty]{fullpage}\r\n\\usepackage{titlesec}\r\n\\usepackage{marvosym}\r\n\\usepackage[usenames,dvipsnames]{color}\r\n\\usepackage{verbatim}\r\n\\usepackage{enumitem}\r\n\\usepackage[hidelinks]{hyperref}\r\n\\usepackage{fancyhdr}\r\n\\usepackage[english]{babel}\r\n\\usepackage{tabularx}\r\n\\input{glyphtounicode}\r\n\r\n%----------FONT OPTIONS----------\r\n\\usepackage[default]{sourcesanspro}\r\n\r\n\\pagestyle{fancy}\r\n\\fancyhf{} % clear all header and footer fields\r\n\\fancyfoot{}\r\n\\renewcommand{\\headrulewidth}{0pt}\r\n\\renewcommand{\\footrulewidth}{0pt}\r\n\r\n% Adjust margins\r\n\\addtolength{\\oddsidemargin}{-0.75in}\r\n\\addtolength{\\evensidemargin}{-0.75in}\r\n\\addtolength{\\textwidth}{1.25in}\r\n\\addtolength{\\topmargin}{-.5in}\r\n\\addtolength{\\textheight}{1.0in}\r\n\r\n\\urlstyle{same}\r\n\r\n\\raggedbottom\r\n\\raggedright\r\n\\setlength{\\tabcolsep}{0in}\r\n\r\n% Sections formatting\r\n\\titleformat{\\section}{\r\n  \\vspace{-4pt}\\scshape\\raggedright\\large\r\n}{}{1em}{}[\\color{black}\\titlerule \\vspace{-5pt}]\r\n\r\n% Ensure that generate pdf is machine readable/ATS parsable\r\n\\pdfgentounicode=1\r\n\r\n%-------------------------\r\n% Custom commands\r\n\\newcommand{\\resumeItem}[1]{\r\n  \\item\\small{\r\n    {#1 \\vspace{-4pt}}\r\n  }\r\n}\r\n\r\n\\newcommand{\\resumeSubheading}[4]{\r\n  \\vspace{-2pt}\\item\r\n    \\begin{tabular*}{0.97\\textwidth}[t]{l@{\\extracolsep{\\fill}}r}\r\n      \\textbf{#1} & #2 \\\\\r\n      \\textit{\\small#3} & \\textit{\\small #4} \\\\\r\n    \\end{tabular*}\\vspace{-7pt}\r\n}\r\n\r\n\\newcommand{\\resumeSubSubheading}[2]{\r\n    \\item\r\n    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\r\n      \\textit{\\small#1} & \\textit{\\small #2} \\\\\r\n    \\end{tabular*}\\vspace{-7pt}\r\n}\r\n\r\n\\newcommand{\\resumeProjectHeading}[2]{\r\n    \\item\r\n    \\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\r\n      \\small#1 & #2 \\\\\r\n    \\end{tabular*}\\vspace{-7pt}\r\n}\r\n\r\n\\newcommand{\\resumeSubItem}[1]{\\resumeItem{#1}\\vspace{-4pt}}\r\n\r\n\\renewcommand\\labelitemii{$\\vcenter{\\hbox{\\tiny$\\bullet$}}$}\r\n\r\n\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=0.15in, label={}]}\r\n\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}\r\n\\newcommand{\\resumeItemListStart}{\\begin{itemize}}\r\n\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-7pt}}\r\n\r\n%-------------------------------------------\r\n%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%\r\n\r\n", body: "{{profile}}\n{{summary}}\n{{experiences}}\n{{skills}}\n{{education}}", page_budget: 1 }));
export function listLatexTemplates(): readonly LatexTemplateProfile[] { return [defaultProfile, careerProfile]; }
export function getLatexTemplate(id: string): LatexTemplateProfile {
  if (id === careerProfile.id) return careerProfile;
  // Historical snapshots are fingerprinted; retain their exact profile for validation.
  // Only the current name is offered in the template picker.
  if (id === 'career-master') return { ...careerProfile, id, name: 'Career Master' };
  if (id !== defaultProfile.id) throw new Error(`Unknown LaTeX template: ${id}`);
  return defaultProfile;
}
