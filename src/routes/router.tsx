import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppShell } from '../ui/layout/AppShell'
import { SpaceOverview } from './SpaceOverview'
import { PageView } from './PageView'
import { EditorView } from './EditorView'
import { NewPageView } from './NewPageView'
import { SearchView } from './SearchView'
import { ArchiveView } from './ArchiveView'
import { SpaceSettingsRoute } from './SpaceSettings'
import { SpacesSettingsList } from './SpacesSettingsList'
import { HistoryView } from './HistoryView'
import { BlameView } from './BlameView'
import { ProfileSettings } from './ProfileSettings'
import { NotFound } from './NotFound'

/**
 * Routes per docs/06-ui-information-architecture.md. The :group parameter
 * carries the full NIP-29 address (host'group), URL-encoded, so that a link
 * works without any extra knowledge.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Navigate to="/settings/spaces" replace /> },
      { path: '/settings/profile', element: <ProfileSettings /> },
      { path: '/settings/spaces', element: <SpacesSettingsList /> },
      { path: '/settings/spaces/:group', element: <SpaceSettingsRoute /> },
      { path: '/s/:group', element: <SpaceOverview /> },
      { path: '/s/:group/new', element: <NewPageView /> },
      { path: '/s/:group/search', element: <SearchView /> },
      // Before `:slug`, so the word is a route and not a page that happens to
      // be called "archive". Same reason `new` and `search` sit up here.
      { path: '/s/:group/archive', element: <ArchiveView /> },
      { path: '/s/:group/:slug', element: <PageView /> },
      { path: '/s/:group/:slug/edit', element: <EditorView /> },
      { path: '/s/:group/:slug/history', element: <HistoryView /> },
      { path: '/s/:group/:slug/blame', element: <BlameView /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
