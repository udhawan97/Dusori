export interface TopicTemplateInput {
  createdAt: string;
  slug: string;
  title: string;
}

export function homeTemplate(name: string, topics: Array<{ slug: string; title: string }>): string {
  const topicLines = topics.length
    ? topics.map((topic) => `- [[Topics/${topic.slug}/Overview|${topic.title}]]`).join('\n')
    : '- No topics yet.';
  return `---\ntitle: ${name}\ntype: dusori-home\n---\n\n# ${name}\n\nA local-first learning workspace.\n\n## Topics\n\n${topicLines}\n`;
}

export function overviewTemplate(input: TopicTemplateInput): string {
  return `---\ntitle: ${input.title}\ntopic: ${input.slug}\nstatus: active\ncreated: ${input.createdAt.slice(0, 10)}\n---\n\n# ${input.title}\n\nUse this page as the durable overview for the topic. Dusori will propose changes instead of silently replacing your edits.\n\n## Start here\n\n- Read [[Notes/001-first-look|First look]].\n- Add learning preferences to [[TUTOR]].\n- Review the [[roadmap]].\n`;
}

export function roadmapTemplate(input: TopicTemplateInput): string {
  return `---\ntitle: ${input.title} roadmap\ntopic: ${input.slug}\nstatus: draft\n---\n\n# Roadmap\n\n- [ ] Establish the terms and boundaries.\n- [ ] Explain the central mechanism in your own words.\n- [ ] Connect the topic to a practical example.\n\nThis first roadmap is deliberately manual. Automated syllabus import is not built yet.\n`;
}

export function tutorTemplate(input: TopicTemplateInput): string {
  return `---\ntitle: ${input.title} learning preferences\ntopic: ${input.slug}\ndepth: layered\n---\n\n# Learning preferences\n\n- Prefer concrete examples before abstractions.\n- Keep source provenance visible.\n- Ask exactly three self-check questions per study note.\n- Never treat generated text as authoritative.\n`;
}

export function firstNoteTemplate(input: TopicTemplateInput): string {
  return `---\ntitle: First look\ntopic: ${input.slug}\nprovenance: user-scaffold\ncreated: ${input.createdAt.slice(0, 10)}\n---\n\n# First look at ${input.title}\n\n## Layer 1 — orientation\n\nWrite the simplest useful explanation of ${input.title} here. The scaffold remains useful without AI.\n\n## Layer 2 — mechanism\n\nTrace one idea from source to understanding, keeping the source and your interpretation distinct.\n\n\`\`\`mermaid\nflowchart LR\n  S[Source] --> N[Note]\n  N --> C[Self-check]\n  C --> U[Update]\n\`\`\`\n\n## Self-check\n\n1. What is the topic trying to explain?\n2. Which term needs a source before you trust it?\n3. How would you test your understanding tomorrow?\n`;
}

export function initialUpdateTemplate(input: TopicTemplateInput): string {
  return `---\ntitle: ${input.createdAt.slice(0, 10)} update\ntopic: ${input.slug}\ntype: dusori-update\n---\n\n# ${input.createdAt.slice(0, 10)}\n\n- Created [[../../Overview|${input.title}]].\n- Added [[../../Notes/001-first-look|First look]].\n- Created the roadmap, learning preferences, source manifest, and machine state.\n`;
}
