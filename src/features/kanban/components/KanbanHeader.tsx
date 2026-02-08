import clsx from "clsx";

const KanbanHeader = () => {
    return <h1 className={
        clsx(
            "m-0 p-4", 
            "w-full bg-[#7D89F0]", 
            "text-4xl text-[#E2FFD1] text-center",
        )}
    >
        Kanban Board
    </h1>
}
export default KanbanHeader;