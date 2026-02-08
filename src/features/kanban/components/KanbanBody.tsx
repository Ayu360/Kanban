import clsx from "clsx";
import KanbanColumn from "./KanbanColumn";

const KanbanBody = () => {
    return (
        <div
            className={
                clsx(
                    "flex gap-4 items-stretch justify-around",
                    " w-full px-4"
                )}
        >
            {
                Array(4).fill(() => 0).map((_, idx) => {
                    return (
                        <KanbanColumn key={idx} id={`droppable_${idx}`} />
                    )
                })
            }
        </div>
    )
}

export default KanbanBody;