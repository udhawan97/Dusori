export type WorkspaceView =
  'graph' | 'insights' | 'note' | 'research' | 'roadmap' | 'settings' | 'sources' | 'today';
export type GraphMode = 'outline' | 'visual';

export interface WorkspaceNavigationState {
  topicSlug: string;
  view: WorkspaceView;
  documentPath: string;
  graphMode: GraphMode;
  creatingTopic: boolean;
  topicCreationReturnSlug: string;
}

export type WorkspaceNavigationIntent =
  | {
      kind: 'open';
      view: WorkspaceView;
      topicSlug?: string;
      documentPath?: string;
      graphMode?: GraphMode;
    }
  | { graphMode: GraphMode; kind: 'set-graph-mode' }
  | { kind: 'start-topic' }
  | { kind: 'cancel-topic' };

export interface WorkspaceNavigationEnvironment {
  pathname: string;
  search: string;
  history: 'none' | 'push' | 'replace';
}

export interface WorkspaceNavigationDecision {
  state: WorkspaceNavigationState;
  history: WorkspaceNavigationEnvironment['history'];
  url: string;
  orient: boolean;
  rejected?: string;
}

const views = new Set<WorkspaceView>([
  'graph',
  'insights',
  'note',
  'research',
  'roadmap',
  'settings',
  'sources',
  'today',
]);
const topicViews = new Set<WorkspaceView>(['note', 'research', 'roadmap', 'sources', 'today']);

function isWorkspaceView(value: string | null): value is WorkspaceView {
  return value !== null && views.has(value as WorkspaceView);
}

function documentTarget(path: string): { path: string; topicSlug: string } | null {
  try {
    const normalized = normalizeWorkspacePath(path);
    const topicSlug = /^Topics\/([^/]+)\/.+/u.exec(normalized)?.[1] ?? '';
    return topicSlug ? { path: normalized, topicSlug } : null;
  } catch {
    return null;
  }
}

export function workspaceNavigationUrl(
  state: Pick<WorkspaceNavigationState, 'documentPath' | 'graphMode' | 'topicSlug' | 'view'>,
  pathname: string,
  search: string,
): string {
  const parameters = new URLSearchParams(search);
  if (state.topicSlug) parameters.set('topic', state.topicSlug);
  else parameters.delete('topic');
  parameters.set('view', state.view);
  if (state.view === 'note' && state.documentPath) parameters.set('path', state.documentPath);
  else parameters.delete('path');
  if (state.view === 'graph' && state.graphMode === 'visual') parameters.set('map', 'visual');
  else parameters.delete('map');
  const query = parameters.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

/** Reads a reload/Back/Forward target without writing history or accepting paths across topics. */
export function parseWorkspaceLocation(
  search: string,
  knownTopics: ReadonlySet<string>,
): Pick<WorkspaceNavigationState, 'documentPath' | 'graphMode' | 'topicSlug' | 'view'> | null {
  const parameters = new URLSearchParams(search);
  const topicSlug = parameters.get('topic') ?? '';
  const requestedView = parameters.get('view');
  const view = isWorkspaceView(requestedView) ? requestedView : 'research';
  if (topicViews.has(view)) {
    if (!knownTopics.has(topicSlug)) return null;
  } else if (topicSlug && !knownTopics.has(topicSlug)) {
    return null;
  }
  const requestedPath = parameters.get('path') ?? '';
  if (view === 'note') {
    const document = documentTarget(requestedPath);
    if (document?.topicSlug !== topicSlug) {
      return { documentPath: '', graphMode: 'outline', topicSlug, view: 'research' };
    }
    return { documentPath: document.path, graphMode: 'outline', topicSlug, view };
  }
  return {
    documentPath: view === 'roadmap' ? `Topics/${topicSlug}/roadmap.md` : '',
    graphMode: view === 'graph' && parameters.get('map') === 'visual' ? 'visual' : 'outline',
    topicSlug,
    view,
  };
}

/**
 * Applies the navigation invariants once. Browser history, document reads, scroll, and focus remain
 * effects of the page edge; this function decides only the next workspace state and URL.
 */
export function transitionWorkspaceNavigation(
  current: WorkspaceNavigationState,
  intent: WorkspaceNavigationIntent,
  environment: WorkspaceNavigationEnvironment,
): WorkspaceNavigationDecision {
  let state: WorkspaceNavigationState;
  if (intent.kind === 'set-graph-mode') {
    if (current.view !== 'graph') {
      return {
        history: 'none',
        orient: false,
        rejected: 'Open the research map before changing its representation.',
        state: current,
        url: workspaceNavigationUrl(current, environment.pathname, environment.search),
      };
    }
    state = { ...current, graphMode: intent.graphMode };
    return {
      history: environment.history,
      orient: false,
      state,
      url: workspaceNavigationUrl(state, environment.pathname, environment.search),
    };
  } else if (intent.kind === 'start-topic') {
    state = {
      ...current,
      creatingTopic: true,
      documentPath: '',
      graphMode: 'outline',
      topicCreationReturnSlug: current.topicSlug,
      topicSlug: '',
      view: 'research',
    };
  } else if (intent.kind === 'cancel-topic') {
    if (!current.topicCreationReturnSlug) {
      return {
        history: 'none',
        orient: false,
        rejected: 'There is no previous topic to restore.',
        state: current,
        url: workspaceNavigationUrl(current, environment.pathname, environment.search),
      };
    }
    state = {
      ...current,
      creatingTopic: false,
      documentPath: '',
      topicCreationReturnSlug: '',
      topicSlug: current.topicCreationReturnSlug,
    };
  } else {
    const document = intent.documentPath ? documentTarget(intent.documentPath) : null;
    if (intent.view === 'note' && !document) {
      return {
        history: 'none',
        orient: false,
        rejected: 'A valid document path is required for the note view.',
        state: current,
        url: workspaceNavigationUrl(current, environment.pathname, environment.search),
      };
    }
    if (document && intent.topicSlug && document.topicSlug !== intent.topicSlug) {
      return {
        history: 'none',
        orient: false,
        rejected: 'The document must belong to the selected topic.',
        state: current,
        url: workspaceNavigationUrl(current, environment.pathname, environment.search),
      };
    }
    const topicSlug = document?.topicSlug || intent.topicSlug || current.topicSlug;
    if (topicViews.has(intent.view) && !topicSlug) {
      return {
        history: 'none',
        orient: false,
        rejected: 'Select or create a topic before opening this view.',
        state: current,
        url: workspaceNavigationUrl(current, environment.pathname, environment.search),
      };
    }
    state = {
      creatingTopic: false,
      documentPath:
        intent.view === 'roadmap'
          ? `Topics/${topicSlug}/roadmap.md`
          : intent.view === 'note'
            ? (document?.path ?? '')
            : '',
      graphMode: intent.view === 'graph' ? (intent.graphMode ?? 'outline') : 'outline',
      topicCreationReturnSlug: '',
      topicSlug,
      view: intent.view,
    };
  }
  return {
    history: environment.history,
    orient: environment.history !== 'none',
    state,
    url: workspaceNavigationUrl(state, environment.pathname, environment.search),
  };
}
import { normalizeWorkspacePath } from '@dusori/core';
