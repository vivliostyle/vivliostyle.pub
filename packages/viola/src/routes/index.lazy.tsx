import { createLazyFileRoute } from '@tanstack/react-router';
import { Editor } from '../components/editor';
import { Preview } from '../components/preview';

export const Route = createLazyFileRoute('/')({
  component: Index,
});

function Index() {
  return (
    <div className="grid grid-cols-2 w-full p-2 gap-2">
      <div>
        <Editor />
      </div>
      <div className="h-screen">
        <Preview />
      </div>
    </div>
  );
}
