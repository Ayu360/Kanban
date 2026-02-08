"use client"
import KanbanBody from "@/features/kanban/components/KanbanBody";
import KanbanHeader from "@/features/kanban/components/KanbanHeader";
import { DndContext } from "@dnd-kit/core";

const KanbanDashBoard = () => {
    return (
        <DndContext>
            <div className="flex flex-col gap-4">

                <KanbanHeader />
                <KanbanBody />
            </div>
        </DndContext>
    )
}

export default KanbanDashBoard;