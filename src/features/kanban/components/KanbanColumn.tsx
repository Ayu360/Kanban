"use client"
import clsx from "clsx";
import { KanbanColumnProps } from "../types/interface";
import { useDroppable } from "@dnd-kit/core";

import dynamic from "next/dynamic";
const KanbanCard = dynamic(() => import("./KanbanCard"),{ssr: false});

const KanbanColumn: React.FC<KanbanColumnProps> = ({ id }) => {
    const { isOver, setNodeRef } = useDroppable({
        id,
    });

    return (
        <div
            ref={setNodeRef}
            className={
                clsx(
                    "flex-1 flex flex-col gap-1",
                    "rounded-sm border min-h-96 text-center",
                    isOver && "border-green-400 bg-green-400 opacity-20"
                )
            }
        >
            <div className="py-7 border-b text-xl">Heading {isOver? "true": "false"}</div>
            <div className="flex flex-col gap-2 items-stretch p-4 text-base">
                {
                    Array(4).fill(() => 0).map((_, idx) => {
                        return (
                            <KanbanCard
                                key={idx}
                                id={`${id + idx}`}
                            />
                        )
                    })
                }
            </div>
        </div>
    )
}

export default KanbanColumn;