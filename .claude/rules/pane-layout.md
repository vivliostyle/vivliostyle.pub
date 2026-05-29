---
paths:
  - "packages/viola/src/components/panes/*.tsx"
---

# Pane layout rules

Rules for implementing panes (`createPane` definitions in `packages/viola/src/components/panes/pane.*.tsx`). Panes render into the layout grid (`layout.tsx`: `size-full grid grid-flow-col auto-cols-fr`), where each grid cell has a **fixed height** equal to the viewport. The grid does not clip overflow itself.

## Keep the scroll container separate from the content component

A pane's scroll container (`ScrollOverflow`, `PaneContainer`, or any `overflow-auto` element) **must live in the `createPane` `content` wrapper, not inside the content component itself**. The content component should return only the real content (the editor, the form, etc.).

```tsx
// Good — scroll container in the wrapper, content component is just the body
export const Pane = createPane<EditPaneProperty>({
  title: Title,
  content: (props) => (
    <ScrollOverflow>
      <ModeToggle {...props} />
      <Content {...props} />
    </ScrollOverflow>
  ),
});

function Content({ contentId, mode }: EditPaneProperty) {
  return mode === 'source' ? <SourceEditor ... /> : <ContentEditor ... />;
}
```

```tsx
// Bad — content component wraps itself in a flex/h-full container
function Content(props) {
  return (
    <div className="flex flex-col h-full">  {/* grows to content height */}
      <Toolbar />
      <div className="flex-1 min-h-0">{/* editor */}</div>
    </div>
  );
}
```

**Why:** the grid cell is fixed-height but does not clip. If the content component introduces its own `h-full` wrapper around tall content, that wrapper grows to the content's intrinsic height (e.g. 3000px) instead of being constrained to the cell. The `overflow-auto` ancestor then never sees `scrollHeight > clientHeight`, so nothing scrolls. Letting the single `ScrollOverflow` wrapper be the direct, height-bounded scroll container — with the content rendered at its natural height inside it — is what makes overflow scrolling work.

**How to apply:** put exactly one `overflow-auto` scroll container in the `content` wrapper. Render editors/bodies at their natural height inside it (e.g. CodeMirror with `w-full`, not `h-full` — `h-full` would pin it to the container and push overflow out of the scroll region). Do not add intermediate `h-full`/`flex-1` height chains in the content component.

## Pin toolbars with `sticky`, not a fixed layout

Toolbars, mode toggles, and other chrome that must stay visible while the body scrolls should use `position: sticky` (`sticky top-0 z-10` with a solid background) **inside** the same scroll container. Do not split the pane into a fixed header + separately-scrolling body — that reintroduces the height-chain problem above.
