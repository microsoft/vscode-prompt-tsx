# Changelog

## 0.3.0-alpha.7

- **feat:** add a `passPriority` attribute for logical wrapper elements
- **fix:** tool calls not being visible in tracer

## 0.3.0-alpha.6

- **fix:** containers without priority set should have max priority

## 0.3.0-alpha.5

- **feat:** add `Expandable` elements to the renderer. See the [readme](./README.md#expandable-text) for details.

## 0.3.0-alpha.4

- **feat:** enhance the `HTMLTracer` to allow consumers to visualize element pruning order

## 0.3.0-alpha.3

- **feat:** add `MetadataMap.getAll()`
- **fix:** don't drop empty messages that have tool calls

## 0.3.0-alpha.2

- **fix:** update to match proposed VS Code tools API

## 0.3.0-alpha.1

- ⚠️ **breaking refactor:** `priority` is now local within tree elements

  Previously, in order to calculate elements to be pruned if the token budget was exceeded, all text in the prompt was collected into a flat list and lowest `priority` elements were removed first; the priority value was global. However, this made composition difficult because all elements needed to operate within the domain of priorities provided by the prompt.

  In this version, priorities are handled as a tree. To prune elements, the lowest priority element is selected among siblings recursively, until a leaf node is selected and removed. Take the tree of elements:

  ```
  A[priority=1]
    A1[priority=50]
    A2[priority=200]
  B[priority=2]
    B1[priority=0]
    B2[priority=100]
  ```

  The pruning order is now `A1`, `A2`, `B1`, then `B2`. Previously it would have been `B1`, `A1`, `B2`, `A2`. In a tiebreaker between two sibling elements with the same priority, the element with the lowest-priority direct child is chosen for pruning. For example, in the case

  ```
  A
    A1[priority=50]
    A2[priority=200]
  B
    B1[priority=0]
    B2[priority=100]
  ```

  The pruning order is `B1`, `A1`, `B2`, `A2`.

- **feature:** new `LegacyPrioritization` element

  There is a new `LegacyPrioritization` which can be used to wrap other elements in order to fall-back to the classic global prioritization model. This is a stepping stone and will be removed in future versions.

  ```tsx
  <LegacyPrioritization>
  	<UserMessage>...</UserMessage>
  	<SystemMessage>...</SystemMessage>
  </LegacyPrioritization>
  ```

- **feature:** new `Chunk` element

  The new `Chunk` element can be used to group elements that should either be all retained, or all pruned. This is similar to a `TextChunk`, but it also allows for extrinsic children. For example, you might wrap content like this to ensure the `FileLink` isn't present without its `FileContents` and vise-versa:

  ```tsx
  <Chunk priority={42}>
    The file I'm editing is: <FileLink file={f}><br />
    <br />
    <FileContents file={f}>
  </Chunk>
  ```

- **feature:** `local` metadata

  Previously, metadata in a prompt was always globally available regardless of where it was positioned and whether the position it was in survived pruning. There is a new `local` flag you can apply such that the metadata is only retained if the element it's in was included in the prompt:

  ```tsx
  <TextChunk>
  	<meta value={new MyMetaData()} local />
  	Hello world!
  </TextChunk>
  ```

  Internally, references are now represented as local metadata.

- ⚠️ **breaking refactor:** metadata is now returned from `render()`

  Rather than being a separate property on the renderer, metadata is now returned in the `RenderPromptResult`.

- **refactor:** whitespace tightening

  The new tree-based rendering allows us to be slightly smarter in how line breaks are inserted and retained. The following rules are in place:

  - Line breaks `<br />` always ensure that there's a line break at the location.
  - The contents of any tag will add a line break before them if one does not exist (between `<A>Hi</A><B>Bye</B>`, for example.)
  - A line break is not automatically inserted for siblings directly following other text (for example, there is no line break in `Check out <Link href="..." />`)
  - Leading and trailing whitespace is removed from chat messages.

  This may result in some churn in existing elements.
