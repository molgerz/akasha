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
import { SPACE_ROUTE_PATTERN, spaceArchiveUrl, spaceNewUrl, spaceSearchUrl } from './space-urls'

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
      // The app's own views live behind '~', a segment no page slug can ever
      // produce: the slug comes off the relay as whoever wrote it normalised
      // the title, and normalizeSlug keeps only letters, numbers, combining
      // marks and '-'. A page titled "Archive" therefore stays reachable at
      // /s/:group/archive instead of opening the archive view (CON-50). The
      // paths are built through space-urls.ts, which owns the prefix, so the
      // routes and the links to them cannot drift apart.
      { path: spaceNewUrl(SPACE_ROUTE_PATTERN), element: <NewPageView /> },
      { path: spaceSearchUrl(SPACE_ROUTE_PATTERN), element: <SearchView /> },
      { path: spaceArchiveUrl(SPACE_ROUTE_PATTERN), element: <ArchiveView /> },
      { path: '/s/:group/:slug', element: <PageView /> },
      { path: '/s/:group/:slug/edit', element: <EditorView /> },
      { path: '/s/:group/:slug/history', element: <HistoryView /> },
      { path: '/s/:group/:slug/blame', element: <BlameView /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])
