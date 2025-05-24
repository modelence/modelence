import {Redirect} from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  // This will redirect to the new Quick Start homepage
  return <Redirect to="/quick-start/intro" />;
}
