import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

export interface SortableItem {
  id: string
  label: string
  detail?: string
}

interface Props {
  items: SortableItem[]
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
}

/**
 * Ordered list reordered by dragging the ≡ handle. Pointer events cover
 * mouse and touch (iOS Safari); the handle has touch-action: none so the
 * rest of the row still scrolls the page.
 */
export function SortableList({ items, onMove, onRemove }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = items.findIndex((i) => i.id === active.id)
    const to = items.findIndex((i) => i.id === over.id)
    if (from >= 0 && to >= 0) onMove(from, to)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <ol className="sortable">
          {items.map((item, index) => (
            <Row key={item.id} item={item} position={index + 1} onRemove={() => onRemove(index)} />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  )
}

function Row({ item, position, onRemove }: { item: SortableItem; position: number; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id })

  return (
    <li
      ref={setNodeRef}
      className={isDragging ? 'sortable-row dragging' : 'sortable-row'}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="drag-handle"
        aria-label={`Drag to reorder ${item.label}`}
        {...attributes}
        {...listeners}
      >
        ≡
      </button>
      <span className="sortable-pos">{position}</span>
      <span className="sortable-text">
        <span className="row-title">{item.label}</span>
        {item.detail && <span className="row-sub">{item.detail}</span>}
      </span>
      <button type="button" className="remove-btn" aria-label={`Remove ${item.label}`} onClick={onRemove}>
        ✕
      </button>
    </li>
  )
}
