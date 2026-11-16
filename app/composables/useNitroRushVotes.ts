import { withVote } from '~/utils/nitro-rush/community'
import type { NrTrackVotes, NrVote } from '#server/utils/nitro-rush-tracks'

/** Every course's votes by id, built-in and published alike, and the player's own voting. */
export function useNitroRushVotes() {
    const toast = useToast()
    const votes = ref<Record<string, NrTrackVotes>>({})
    /** Courses with a vote in flight. */
    const voting = ref(new Set<string>())

    /** Counts from a menu list; a course with a vote in flight keeps the one shown, which the vote's answer settles. */
    function addVotes(list: Record<string, NrTrackVotes>) {
        const fresh = Object.fromEntries(Object.entries(list).filter(([id]) => !voting.value.has(id)))
        votes.value = { ...votes.value, ...fresh }
    }

    /** Sets the player's vote on a course, shown at once and put back if the server refuses it. */
    async function vote(trackId: string, value: NrVote) {
        const before = votes.value[trackId]
        // One vote per course at a time, so a quick second tap can't land before the first.
        if (!before || voting.value.has(trackId)) return
        votes.value = { ...votes.value, [trackId]: withVote(before, value) }
        voting.value.add(trackId)
        try {
            const res = await apiPost('/api/nitro-rush/vote', { trackId, vote: value })
            votes.value = { ...votes.value, [trackId]: { up: res.up, down: res.down, myVote: res.myVote } }
        } catch (e) {
            votes.value = { ...votes.value, [trackId]: before }
            toast.add({ title: apiErrorMessage(e, 'Vote not saved'), color: 'warning' })
        } finally {
            voting.value.delete(trackId)
        }
    }

    return { votes, voting, addVotes, vote }
}
