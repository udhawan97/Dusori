import { describe, expect, it } from 'vitest';

import {
  parseWorkspaceLocation,
  transitionWorkspaceNavigation,
  workspaceNavigationUrl,
  type WorkspaceNavigationState,
} from './workspace-navigation.js';

const current: WorkspaceNavigationState = {
  creatingTopic: false,
  documentPath: '',
  topicCreationReturnSlug: '',
  topicSlug: 'typescript',
  view: 'research',
};
const environment = { history: 'push' as const, pathname: '/app/', search: '?token=kept' };

describe('workspace navigation', () => {
  it.each([
    ['today', '', '?token=kept&topic=typescript&view=today'],
    ['roadmap', 'Topics/typescript/roadmap.md', '?token=kept&topic=typescript&view=roadmap'],
    ['settings', '', '?token=kept&topic=typescript&view=settings'],
  ] as const)('opens %s with shared reset and URL rules', (view, documentPath, query) => {
    const decision = transitionWorkspaceNavigation(current, { kind: 'open', view }, environment);

    expect(decision.state).toMatchObject({
      creatingTopic: false,
      documentPath,
      topicCreationReturnSlug: '',
      topicSlug: 'typescript',
      view,
    });
    expect(decision.url).toBe(`/app/${query}`);
    expect(decision.orient).toBe(true);
  });

  it('infers a topic from a document and rejects cross-topic path restoration', () => {
    const opened = transitionWorkspaceNavigation(
      current,
      { kind: 'open', view: 'note', documentPath: 'Topics/rust/Notes/ownership.md' },
      environment,
    );
    expect(opened.state.topicSlug).toBe('rust');
    expect(opened.url).toContain('path=Topics%2Frust%2FNotes%2Fownership.md');

    expect(
      parseWorkspaceLocation(
        '?topic=typescript&view=note&path=Topics/rust/Notes/ownership.md',
        new Set(['typescript', 'rust']),
      ),
    ).toEqual({ documentPath: '', topicSlug: 'typescript', view: 'research' });
  });

  it('restores a valid location without creating a history decision', () => {
    const restored = parseWorkspaceLocation(
      '?topic=typescript&view=sources&campaign=kept',
      new Set(['typescript']),
    );
    expect(restored).toEqual({ documentPath: '', topicSlug: 'typescript', view: 'sources' });
    expect(workspaceNavigationUrl(restored!, '/app/', '?campaign=kept&topic=old&path=old')).toBe(
      '/app/?campaign=kept&topic=typescript&view=sources',
    );
  });

  it('restores a global Settings view without requiring a topic', () => {
    const restored = parseWorkspaceLocation('?view=settings&campaign=kept', new Set());
    expect(restored).toEqual({ documentPath: '', topicSlug: '', view: 'settings' });
    expect(workspaceNavigationUrl(restored!, '/app/', '?campaign=kept')).toBe(
      '/app/?campaign=kept&view=settings',
    );
  });

  it.each([
    'Topics/typescript/../dusori.json',
    'Topics/typescript/Notes/../../dusori.json',
    '/Topics/typescript/Notes/absolute.md',
    'Topics\\typescript\\..\\dusori.json',
  ])('rejects the unsafe note path %s', (documentPath) => {
    const decision = transitionWorkspaceNavigation(
      current,
      { documentPath, kind: 'open', view: 'note' },
      environment,
    );
    expect(decision.rejected).toMatch(/valid document path/u);
    expect(decision.state).toBe(current);
    expect(
      parseWorkspaceLocation(
        `?topic=typescript&view=note&path=${encodeURIComponent(documentPath)}`,
        new Set(['typescript']),
      ),
    ).toEqual({ documentPath: '', topicSlug: 'typescript', view: 'research' });
  });

  it('rejects an explicit topic that disagrees with the note path', () => {
    const decision = transitionWorkspaceNavigation(
      current,
      {
        documentPath: 'Topics/rust/Notes/ownership.md',
        kind: 'open',
        topicSlug: 'typescript',
        view: 'note',
      },
      environment,
    );
    expect(decision.rejected).toMatch(/selected topic/u);
    expect(decision.state).toBe(current);
  });

  it('preserves none and replace history decisions', () => {
    for (const history of ['none', 'replace'] as const) {
      const decision = transitionWorkspaceNavigation(
        current,
        { kind: 'open', view: 'today' },
        {
          ...environment,
          history,
        },
      );
      expect(decision.history).toBe(history);
      expect(decision.orient).toBe(history !== 'none');
    }
  });

  it('remembers and restores the topic around new-topic mode', () => {
    const started = transitionWorkspaceNavigation(current, { kind: 'start-topic' }, environment);
    expect(started.state).toMatchObject({
      creatingTopic: true,
      topicCreationReturnSlug: 'typescript',
      topicSlug: '',
      view: 'research',
    });
    const cancelled = transitionWorkspaceNavigation(
      started.state,
      { kind: 'cancel-topic' },
      environment,
    );
    expect(cancelled.state).toMatchObject({
      creatingTopic: false,
      topicCreationReturnSlug: '',
      topicSlug: 'typescript',
    });
  });

  it('rejects a topic view with no topic and leaves state unchanged', () => {
    const decision = transitionWorkspaceNavigation(
      { ...current, topicSlug: '' },
      { kind: 'open', view: 'research' },
      environment,
    );
    expect(decision.rejected).toMatch(/Select or create/u);
    expect(decision.state.topicSlug).toBe('');
  });
});
