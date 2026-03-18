import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getBoard,
  moveTopic as moveTopicApi,
  updateTopic as updateTopicApi,
  updateColumn as updateColumnApi,
} from "@/lib/fakeApi";
import type { BoardWithDetails } from "@/features/kanban/types";

export const boardKeys = {
  all: ["board"] as const,
  detail: (userId: string) => [...boardKeys.all, userId] as const,
};

export function useBoard(userId: string | undefined) {
  return useQuery({
    queryKey: boardKeys.detail(userId ?? ""),
    queryFn: () => getBoard(userId!),
    enabled: !!userId,
  });
}

function applyOptimisticMove(
  prev: BoardWithDetails | undefined,
  topicId: string,
  newColumnId: string
): BoardWithDetails | undefined {
  if (!prev) return prev;
  const topics = prev.topics.map((t) =>
    t.id === topicId ? { ...t, columnId: newColumnId } : t
  );
  return { ...prev, topics };
}

export function useMoveTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      topicId: string;
      newColumnId: string;
      boardId: string;
      userId: string;
    }) => moveTopicApi(params),
    onMutate: async (variables) => {
      const { userId, topicId, newColumnId } = variables;
      const key = boardKeys.detail(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<BoardWithDetails>(key);
      queryClient.setQueryData<BoardWithDetails>(key, (old) =>
        applyOptimisticMove(old, topicId, newColumnId)
      );
      return { previous };
    },
    onError: (_err, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          boardKeys.detail(variables.userId),
          context.previous
        );
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({
        queryKey: boardKeys.detail(variables.userId),
      });
    },
  });
}

export function useUpdateTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      id: string;
      title: string;
      description: string;
      boardId: string;
      userId: string;
    }) => updateTopicApi(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.userId) });
    },
  });
}

export function useUpdateColumn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      id: string;
      title: string;
      boardId: string;
      userId: string;
    }) => updateColumnApi(params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.detail(variables.userId) });
    },
  });
}
