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
export function listLatexTemplates(): readonly LatexTemplateProfile[] { return [defaultProfile]; }
export function getLatexTemplate(id: string): LatexTemplateProfile {
  if (id !== defaultProfile.id) throw new Error(`Unknown LaTeX template: ${id}`);
  return defaultProfile;
}
