import { createLazyFileRoute } from '@tanstack/react-router';
import { Layout } from '../components/layout';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

function Index() {
  return <Layout />;
}
