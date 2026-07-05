import { SidebarItem } from '@backstage/core-components';
import AndroidIcon from '@material-ui/icons/Android';
import { agentCatalogNavItem } from '../nav';

export const AgentCatalogSidebarItem = () => (
  <SidebarItem
    icon={AndroidIcon}
    to={agentCatalogNavItem.path}
    text={agentCatalogNavItem.title}
  />
);
