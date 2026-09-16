import { describe, it, expect, beforeEach } from 'vitest';
import {
  ResumeSpec,
  ResumeSpecSchema,
  ResumeProfileSchema,
  ResumeExperienceSchema,
  ResumeEducationSchema,
  ResumeSkillGroupSchema,
  compileMarkdownResume,
  compileHtmlPrintResume,
  compileBragDoc,
  compileTypstResume,
  compileLatexResume,
  LevelingRubric,
  EvidenceStore,
  PrivacyRulesConfig,
  EvidenceEntry,
} from '../src/index.js';

describe('Resume Schemas', () => {
  const validSpec: ResumeSpec = {
    profile: {
      name: 'Alex Mercer',
      title: 'Staff Software Engineer',
      email: 'alex.mercer@example.com',
      phone: '(555) 123-4567',
      location: 'San Francisco, CA',
      links: {
        github: 'https://github.com/alexmercer',
        linkedin: 'https://linkedin.com/in/alexmercer',
        website: 'https://alexmercer.dev',
      },
    },
    summary: 'Distributed systems engineer with 10+ years architecting high-throughput resilient services.',
    experiences: [
      {
        company: 'CloudMatrix Technologies',
        role: 'Staff Software Engineer',
        location: 'Remote, US',
        startDate: '2023-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Architected token rotation protocol eliminating session invalidations during DB switch (ev-042).',
            citations: ['ev-042'],
          },
          {
            text: 'Reduced re-auth events by 99.4% across 140k daily active users.',
          },
        ],
      },
    ],
    education: [
      {
        institution: 'University of California, Berkeley',
        degree: 'B.S. in Computer Science',
        year: '2016',
        details: 'High Honors, Systems Specialization',
      },
    ],
    skills: [
      {
        category: 'Languages',
        skills: ['TypeScript', 'Go', 'Rust', 'Python', 'SQL'],
      },
      {
        category: 'Infrastructure',
        skills: ['Kubernetes', 'Docker', 'AWS', 'Terraform', 'Kafka'],
      },
    ],
  };

  it('validates a complete valid resume specification', () => {
    const parsed = ResumeSpecSchema.parse(validSpec);
    expect(parsed.profile.name).toBe('Alex Mercer');
    expect(parsed.experiences).toHaveLength(1);
    expect(parsed.education).toHaveLength(1);
    expect(parsed.skills).toHaveLength(2);
  });

  it('validates minimal resume specification without optional fields', () => {
    const minimal = {
      profile: {
        name: 'Jordan Lee',
        title: 'Software Engineer',
        email: 'jordan@example.com',
      },
      experiences: [],
      education: [],
      skills: [],
    };
    const parsed = ResumeSpecSchema.parse(minimal);
    expect(parsed.profile.name).toBe('Jordan Lee');
    expect(parsed.summary).toBeUndefined();
    expect(parsed.experiences).toEqual([]);
  });

  it('accepts numeric education year and converts or accepts it', () => {
    const edu = {
      institution: 'MIT',
      degree: 'M.S. EECS',
      year: 2020,
    };
    const parsed = ResumeEducationSchema.parse(edu);
    expect(String(parsed.year)).toBe('2020');
  });

  it('rejects missing required profile fields', () => {
    expect(() => ResumeProfileSchema.parse({ name: 'Alex' })).toThrow();
    expect(() => ResumeProfileSchema.parse({ email: 'alex@example.com' })).toThrow();
  });

  it('rejects invalid experience structures', () => {
    expect(() =>
      ResumeExperienceSchema.parse({
        company: 'Acme',
        // missing role, startDate, endDate
      })
    ).toThrow();
  });
});

describe('compileMarkdownResume', () => {
  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Elena Rostova',
      title: 'Principal Platform Engineer',
      email: 'elena@example.com',
      phone: '+1 (415) 555-0199',
      location: 'Seattle, WA',
      links: {
        github: 'https://github.com/erostova',
        linkedin: 'https://linkedin.com/in/erostova',
      },
    },
    summary: 'Platform architect scaling mission-critical cloud infrastructure and developer tooling.',
    experiences: [
      {
        company: 'Nimbus Platform',
        role: 'Principal Engineer',
        location: 'Seattle, WA',
        startDate: '2022-03',
        endDate: 'Present',
        bullets: [
          {
            text: 'Led migration of monolith to microservices on Kubernetes cluster (ev-014).',
            citations: ['ev-014'],
          },
          {
            text: 'Refactored auth pipeline for Project Falcon (AUTH-902) resolving critical race condition.',
          },
        ],
      },
    ],
    education: [
      {
        institution: 'University of Washington',
        degree: 'B.S. in Computer Engineering',
        year: '2015',
        details: 'Summa Cum Laude',
      },
    ],
    skills: [
      {
        category: 'Cloud & Systems',
        skills: ['Kubernetes', 'Go', 'gRPC', 'Distributed Tracing'],
      },
    ],
  };

  it('generates an ATS-friendly markdown resume with all standard sections', () => {
    const md = compileMarkdownResume(sampleSpec);

    // Profile header
    expect(md).toContain('# Elena Rostova');
    expect(md).toContain('Principal Platform Engineer');
    expect(md).toContain('elena@example.com');
    expect(md).toContain('+1 (415) 555-0199');
    expect(md).toContain('Seattle, WA');
    expect(md).toContain('https://github.com/erostova');
    expect(md).toContain('https://linkedin.com/in/erostova');

    // Sections
    expect(md).toContain('## Summary');
    expect(md).toContain(sampleSpec.summary!);

    expect(md).toContain('## Experience');
    expect(md).toContain('Nimbus Platform');
    expect(md).toContain('Principal Engineer');
    expect(md).toContain('2022-03');
    expect(md).toContain('Present');

    expect(md).toContain('## Education');
    expect(md).toContain('University of Washington');
    expect(md).toContain('B.S. in Computer Engineering');
    expect(md).toContain('2015');
    expect(md).toContain('Summa Cum Laude');

    expect(md).toContain('## Skills');
    expect(md).toContain('Cloud & Systems');
    expect(md).toContain('Kubernetes, Go, gRPC, Distributed Tracing');
  });

  it('automatically strips citation tags (ev-###) even without privacy rules', () => {
    const md = compileMarkdownResume(sampleSpec);
    expect(md).not.toContain('(ev-014)');
    expect(md).not.toContain('ev-014');
    expect(md).toContain('Led migration of monolith to microservices on Kubernetes cluster.');
  });

  it('redacts internal ticket IDs and confidential terms when privacy rules are provided', () => {
    const rules: PrivacyRulesConfig = {
      strip_patterns: ['AUTH-\\d+'],
      replacements: [
        { search: 'Project Falcon', replace: 'Core Identity Platform' },
        { search: 'Nimbus Platform', replace: 'Enterprise SaaS' },
      ],
      banned_keywords: ['Project Falcon'],
    };

    const md = compileMarkdownResume(sampleSpec, rules);

    // Citations stripped
    expect(md).not.toContain('ev-014');
    // Ticket ID stripped
    expect(md).not.toContain('AUTH-902');
    // Entity replaced
    expect(md).not.toContain('Project Falcon');
    expect(md).toContain('Core Identity Platform');
    expect(md).toContain('Enterprise SaaS');
    expect(md).not.toContain('Nimbus Platform');

    // Spacing normalized around stripped ticket ID
    expect(md).not.toContain('()');
    expect(md).not.toContain('  ');
  });

  it('omits summary section when summary is not provided', () => {
    const specWithoutSummary = { ...sampleSpec, summary: undefined };
    const md = compileMarkdownResume(specWithoutSummary);
    expect(md).not.toContain('## Summary');
  });
});

describe('compileHtmlPrintResume', () => {
  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Morgan Blake',
      title: 'Staff Frontend Engineer',
      email: 'morgan@example.com',
      phone: '555-0100',
      location: 'New York, NY',
      links: {
        website: 'https://morganblake.com',
      },
    },
    summary: 'Design systems and accessibility leader with deep frontend infrastructure expertise.',
    experiences: [
      {
        company: 'Acme Corp',
        role: 'Staff UI Architect',
        location: 'New York, NY',
        startDate: '2021-06',
        endDate: 'Present',
        bullets: [
          {
            text: 'Created multi-brand component library adopting WCAG 2.1 AA standards (ev-088).',
            citations: ['ev-088'],
          },
          {
            text: 'Optimized bundle size by 42% for SecretInitiative (JIRA-404).',
          },
        ],
      },
    ],
    education: [
      {
        institution: 'Cornell University',
        degree: 'B.A. Information Science',
        year: '2017',
      },
    ],
    skills: [
      {
        category: 'Frontend',
        skills: ['React', 'TypeScript', 'CSS/PostCSS', 'ARIA'],
      },
    ],
  };

  it('generates a complete standalone HTML document with embedded print styling', () => {
    const html = compileHtmlPrintResume(sampleSpec);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');

    // Print CSS rules
    expect(html).toContain('@media print');
    expect(html).toContain('@page');
    expect(html).toContain('size: letter');
    expect(html).toContain('margin: 0.5in');
    expect(html).toContain('break-inside: avoid');
  });

  it('renders all sections and profile details into proper HTML tags', () => {
    const html = compileHtmlPrintResume(sampleSpec);

    expect(html).toContain('Morgan Blake');
    expect(html).toContain('Staff Frontend Engineer');
    expect(html).toContain('morgan@example.com');
    expect(html).toContain('555-0100');
    expect(html).toContain('New York, NY');
    expect(html).toContain('https://morganblake.com');

    expect(html).toContain('Acme Corp');
    expect(html).toContain('Staff UI Architect');
    expect(html).toContain('Cornell University');
    expect(html).toContain('B.A. Information Science');
    expect(html).toContain('Frontend');
    expect(html).toContain('React, TypeScript, CSS/PostCSS, ARIA');
  });

  it('redacts citations and private patterns cleanly in HTML output', () => {
    const rules: PrivacyRulesConfig = {
      strip_patterns: ['JIRA-\\d+'],
      replacements: [{ search: 'SecretInitiative', replace: 'Core Web Client' }],
      banned_keywords: ['SecretInitiative'],
    };

    const html = compileHtmlPrintResume(sampleSpec, rules);

    expect(html).not.toContain('ev-088');
    expect(html).not.toContain('JIRA-404');
    expect(html).not.toContain('SecretInitiative');
    expect(html).toContain('Core Web Client');
  });

  it('escapes special HTML characters in text', () => {
    const specWithHtml: ResumeSpec = {
      ...sampleSpec,
      profile: {
        ...sampleSpec.profile,
        title: 'Platform <Lead> & Architect',
      },
    };
    const html = compileHtmlPrintResume(specWithHtml);
    expect(html).toContain('Platform &lt;Lead&gt; &amp; Architect');
    expect(html).not.toContain('<Lead>');
  });
});

describe('compileBragDoc', () => {
  let store: EvidenceStore;

  const mockRubric: LevelingRubric = {
    id: 'rubric-swe-staff',
    title: 'Staff Software Engineer Rubric',
    target_level: 'L6',
    levels: [
      { id: 'L5', name: 'Senior Engineer' },
      { id: 'L6', name: 'Staff Engineer' },
    ],
    competencies: [
      {
        id: 'comp-sys-arch',
        name: 'System Architecture & Design',
        levels: {
          L5: 'Designs components within a single domain.',
          L6: 'Designs multi-system architectures with fault tolerance and cross-org contracts.',
        },
        evidence_mapped: [
          {
            ev_id: 'ev-101',
            relevance: 'Demonstrates cross-system schema contract and zero-downtime cutover.',
            narrative: 'Authored architectural RFC and coordinated 4 team deployment.',
          },
          {
            ev_id: 'ev-102',
            relevance: 'Evaluates fault isolation during datacenter failover.',
          },
        ],
      },
      {
        id: 'comp-mentorship',
        name: 'Mentorship & Technical Leadership',
        levels: {
          L5: 'Mentors junior engineers on the team.',
          L6: 'Multiplies engineering productivity across multiple squads.',
        },
        evidence_mapped: [
          {
            ev_id: 'ev-103',
            relevance: 'Established org-wide design review guild.',
          },
        ],
      },
      {
        id: 'comp-execution',
        name: 'Operational Excellence',
        levels: {
          L5: 'Maintains runbooks and participates in oncall.',
          L6: 'Defines SLOs, disaster recovery, and reduces systemic incident volume.',
        },
        evidence_mapped: [], // empty to test unmapped / gap
      },
    ],
  };

  const ev101: EvidenceEntry = {
    id: 'ev-101',
    date: '2026-02-15',
    company: 'FintechGlobal',
    title: 'Multi-Region Ledger Replication Engine',
    summary: 'Architected distributed event replication reducing cross-region skew to under 15ms.',
    impact: 'Cut payment settlement latency by 80% and preserved zero data loss during simulated partition.',
    themes: ['distributed-systems', 'architecture'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'latency reduction', value: '80%', status: 'verified' },
      { name: 'replication skew', value: '<15ms', status: 'verified' },
    ],
    internal_references: [{ type: 'jira', ref: 'LEDGER-492' }],
  };

  const ev102: EvidenceEntry = {
    id: 'ev-102',
    date: '2026-03-20',
    company: 'FintechGlobal',
    title: 'Datacenter Failover Automation',
    summary: 'Automated regional failover routing via BGP health checks for Project Titan.',
    impact: 'Targeting recovery time objective under 60 seconds [METRIC NEEDED].',
    themes: ['reliability'],
    confidence: 'provisional', // Provisional with missing metrics
    in_flight: true,
    metrics: [
      { name: 'RTO', value: '[METRIC NEEDED]', status: 'unverified' },
    ],
    internal_references: [{ type: 'incident', ref: 'INC-991' }],
  };

  const ev103: EvidenceEntry = {
    id: 'ev-103',
    date: '2026-04-10',
    company: 'FintechGlobal',
    title: 'Engineering Guild Bootstrap',
    summary: 'Created weekly architecture review forum onboarding 45 engineers across 6 teams.',
    impact: 'Reduced architectural review turnaround from 3 weeks to 4 business days.',
    themes: ['leadership', 'mentorship'],
    confidence: 'verified',
    in_flight: false,
    metrics: [
      { name: 'review turnaround', value: '4 days', status: 'verified' },
    ],
    internal_references: [],
  };

  beforeEach(() => {
    store = new EvidenceStore();
    store.add(ev101, 'Led design review with 12 engineers and deployed in 3 stages.');
    store.add(ev102, 'Ongoing active trial on staging cluster.');
    store.add(ev103, 'Held 12 consecutive weekly sessions with 95% attendance.');
  });

  it('compiles a promotion brag doc grouped by competencies', () => {
    const doc = compileBragDoc(mockRubric, store, {
      candidateName: 'Samira Khan',
      period: '2026-H1',
    });

    expect(doc).toContain('Samira Khan');
    expect(doc).toContain('2026-H1');
    expect(doc).toContain('Staff Software Engineer Rubric');
    expect(doc).toContain('System Architecture & Design');
    expect(doc).toContain('Mentorship & Technical Leadership');
    expect(doc).toContain('Operational Excellence');

    // Inlines target level expectations
    expect(doc).toContain('Designs multi-system architectures with fault tolerance and cross-org contracts.');

    // Inlines accomplishments and impact
    expect(doc).toContain('Multi-Region Ledger Replication Engine');
    expect(doc).toContain('Architected distributed event replication');
    expect(doc).toContain('Cut payment settlement latency by 80%');
    expect(doc).toContain('latency reduction: 80%');
  });

  it('flags provisional evidence and missing metrics clearly', () => {
    const doc = compileBragDoc(mockRubric, store);

    // ev-102 has provisional confidence and unverified metrics
    expect(doc).toContain('Datacenter Failover Automation');
    expect(doc).toMatch(/\[PROVISIONAL\]|Provisional/i);
    expect(doc).toMatch(/\[MISSING METRICS\]|Missing Metrics/i);
    expect(doc).toMatch(/\[IN-FLIGHT\]|In-Flight/i);
  });

  it('indicates when a competency has no mapped evidence (gap)', () => {
    const doc = compileBragDoc(mockRubric, store);
    expect(doc).toContain('Operational Excellence');
    expect(doc).toMatch(/No evidence mapped|Gap/i);
  });

  it('redacts confidential details when rules are provided to brag doc compiler', () => {
    const rules: PrivacyRulesConfig = {
      strip_patterns: ['LEDGER-\\d+', 'INC-\\d+'],
      replacements: [
        { search: 'Project Titan', replace: 'Global Infrastructure' },
        { search: 'FintechGlobal', replace: 'Enterprise Financial' },
      ],
      banned_keywords: ['Project Titan'],
    };

    const doc = compileBragDoc(mockRubric, store, { rules });

    expect(doc).not.toContain('LEDGER-492');
    expect(doc).not.toContain('INC-991');
    expect(doc).not.toContain('Project Titan');
    expect(doc).toContain('Global Infrastructure');
    expect(doc).not.toContain('FintechGlobal');
    expect(doc).toContain('Enterprise Financial');
  });

  it('does not redact sensitive terms when no rules are provided', () => {
    const doc = compileBragDoc(mockRubric, store);
    expect(doc).toContain('Project Titan');
    expect(doc).toContain('FintechGlobal');
  });
});

describe('compileTypstResume', () => {
  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Kai Chen',
      title: 'Senior Site Reliability Engineer',
      email: 'kai@example.com',
      phone: '+1 650 555 0123',
      location: 'Mountain View, CA',
      links: {
        github: 'https://github.com/kaichen',
        linkedin: 'https://linkedin.com/in/kaichen',
      },
    },
    summary: 'SRE focused on zero-downtime deployments, eBPF telemetry, and chaos engineering.',
    experiences: [
      {
        company: 'CloudMatrix',
        role: 'Senior SRE',
        location: 'Mountain View, CA',
        startDate: '2021-01',
        endDate: 'Present',
        bullets: [
          {
            text: 'Engineered automated canary analysis cutting incident blast radius by 75% (ev-077).',
            citations: ['ev-077'],
          },
          {
            text: 'Implemented eBPF packet filter for InternalProject dropping 99.9% of SYN floods.',
          },
        ],
      },
    ],
    education: [
      {
        institution: 'Stanford University',
        degree: 'B.S. in Electrical Engineering',
        year: '2019',
      },
    ],
    skills: [
      {
        category: 'SRE & DevOps',
        skills: ['eBPF', 'Terraform', 'Prometheus', 'Linux Kernel'],
      },
    ],
  };

  it('generates valid Typst code with page, font, and margin configuration', () => {
    const typ = compileTypstResume(sampleSpec);

    expect(typ).toContain('#set page(');
    expect(typ).toMatch(/margin:\s*\(/);
    expect(typ).toContain('#set text(');
    expect(typ).toContain('Kai Chen');
    expect(typ).toContain('Senior Site Reliability Engineer');
    expect(typ).toContain('kai@example.com');
    expect(typ).toContain('CloudMatrix');
    expect(typ).toContain('Senior SRE');
    expect(typ).toContain('Stanford University');
    expect(typ).toContain('eBPF, Terraform, Prometheus, Linux Kernel');

    // Check bullet syntax
    expect(typ).toMatch(/- /);
  });

  it('strips citations and redacts confidential terms in Typst bullets', () => {
    const rules: PrivacyRulesConfig = {
      strip_patterns: [],
      replacements: [{ search: 'InternalProject', replace: 'Edge Gateway' }],
      banned_keywords: ['InternalProject'],
    };

    const typ = compileTypstResume(sampleSpec, rules);

    expect(typ).not.toContain('ev-077');
    expect(typ).not.toContain('InternalProject');
    expect(typ).toContain('Edge Gateway');
  });

  it('escapes Typst special characters ($ # @ [ ]) in raw text', () => {
    const specWithSpecials: ResumeSpec = {
      ...sampleSpec,
      summary: 'Saved $5M through cloud optimization #1 priority [verified].',
    };

    const typ = compileTypstResume(specWithSpecials);
    expect(typ).toContain('\\$5M');
    expect(typ).toContain('\\#1');
  });
});

describe('compileLatexResume', () => {
  const sampleSpec: ResumeSpec = {
    profile: {
      name: 'Taylor Swift-Dev',
      title: 'Lead Systems Engineer',
      email: 'taylor@example.com',
      phone: '555-0188',
      location: 'Austin, TX',
      links: {
        github: 'https://github.com/taylordev',
        linkedin: 'https://linkedin.com/in/taylordev',
      },
    },
    summary: 'Systems programmer experienced in C++, Rust, and low-latency financial protocols.',
    experiences: [
      {
        company: 'Apex Markets',
        role: 'Lead Systems Engineer',
        location: 'Austin, TX',
        startDate: '2020-05',
        endDate: 'Present',
        bullets: [
          {
            text: 'Achieved 99.999% uptime & cut p99 latency to 4.2us (ev-050).',
            citations: ['ev-050'],
          },
          {
            text: 'Saved $1.2M annually by optimizing memory_pool cache (TICKET_100).',
          },
        ],
      },
    ],
    education: [
      {
        institution: 'UT Austin',
        degree: 'B.S. Computer Science & Mathematics',
        year: '2018',
        details: 'GPA: 3.95/4.0',
      },
    ],
    skills: [
      {
        category: 'Languages & Tools',
        skills: ['C++20', 'Rust', 'Linux', 'CMake'],
      },
    ],
  };

  it('generates clean LaTeX source code with standard packages and 1-page margins', () => {
    const tex = compileLatexResume(sampleSpec);

    expect(tex).toContain('\\documentclass');
    expect(tex).toContain('\\usepackage{geometry}');
    expect(tex).toContain('\\usepackage[hidelinks]{hyperref}');
    expect(tex).toContain('\\usepackage{enumitem}');
    expect(tex).toContain('\\begin{document}');
    expect(tex).toContain('\\end{document}');

    // Checks sections
    expect(tex).toContain('\\section{');
    expect(tex).toContain('Taylor Swift-Dev');
    expect(tex).toContain('Lead Systems Engineer');
    expect(tex).toContain('Apex Markets');
    expect(tex).toContain('UT Austin');
  });

  it('sanitizes LaTeX special characters (%, &, _, $)', () => {
    const tex = compileLatexResume(sampleSpec);

    // % -> \%
    expect(tex).toContain('99.999\\%');
    expect(tex).not.toMatch(/99\.999%(?!\\)/);

    // & -> \&
    expect(tex).toContain('\\&');
    expect(tex).not.toMatch(/(?<!\\)&/);

    // $ -> \$
    expect(tex).toContain('\\$1.2M');
    expect(tex).not.toMatch(/(?<!\\)\$1\.2M/);

    // _ -> \_
    expect(tex).toContain('memory\\_pool');
    expect(tex).not.toMatch(/(?<!\\)memory_pool/);
  });

  it('strips citations and applies privacy rules in LaTeX output', () => {
    const rules: PrivacyRulesConfig = {
      strip_patterns: ['TICKET_\\d+'],
      replacements: [{ search: 'Apex Markets', replace: 'Global Trading Firm' }],
      banned_keywords: ['TICKET_100'],
    };

    const tex = compileLatexResume(sampleSpec, rules);

    expect(tex).not.toContain('ev-050');
    expect(tex).not.toContain('TICKET_100');
    expect(tex).not.toContain('Apex Markets');
    expect(tex).toContain('Global Trading Firm');
  });
});
