import { Navigate, useParams } from 'react-router-dom';
import { workspaceTarget } from '../navigation';
import { landingFor } from '../../lib/landing';

/** Old workspace overview pages (/workspaces/:id) now open the first page of the section that replaced them. */
export function Workspace({ role }: { role?: string }) {
  const { workspaceId = '' } = useParams();
  return <Navigate to={workspaceTarget(role, workspaceId) ?? landingFor(role)} replace />;
}
