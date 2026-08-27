import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getConversations,
  getMessages,
  createConversation,
} from "@/services/mentor.service";
import { QUERY_KEYS } from "@/constants/queryKeys";
import { defaultQueryOptions } from "@/lib/queryOptions";

export function useMentorConversations({ enabled = true } = {}) {
  return useQuery({
    queryKey: [QUERY_KEYS.MENTOR_CONVERSATIONS],
    queryFn: async () => {
      const res = await getConversations();
      return res.data || [];
    },
    ...defaultQueryOptions,
    enabled,
  });
}

export function useMentorMessages(conversationId) {
  return useQuery({
    queryKey: [QUERY_KEYS.MENTOR_MESSAGES, conversationId],
    queryFn: async () => {
      const res = await getMessages(conversationId);
      return res.data || [];
    },
    enabled: Boolean(conversationId),
    ...defaultQueryOptions,
  });
}

export function useCreateMentorConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title) => createConversation(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.MENTOR_CONVERSATIONS] });
    },
  });
}
