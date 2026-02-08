"use client"
import { useDraggable } from "@dnd-kit/core";
import { KanbanCardProps } from "../types/interface";

const KanbanCard: React.FC<KanbanCardProps> = ({ id }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: `dragable_${id}`,
    });
    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    } : undefined;

    return (
        <div
            className="p-4 text-center border rounded-sm"
            {...attributes}
            {...listeners}
            style={style}
            ref={setNodeRef}
        >
            description
        </div>
    )
}

export default KanbanCard;