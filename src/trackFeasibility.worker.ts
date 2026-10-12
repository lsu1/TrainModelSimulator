import { searchTrackFeasibility } from './trackFeasibility'
import type { TrackHelperWorkerRequest, TrackHelperWorkerResponse } from './trackHelperTypes'

const worker = self as unknown as { onmessage: ((event: MessageEvent<TrackHelperWorkerRequest>) => void) | null; postMessage(message: TrackHelperWorkerResponse): void }
worker.onmessage = ({ data }) => {
  try { worker.postMessage({ id: data.id, result: searchTrackFeasibility(data.request) }) }
  catch (error) { worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'The track check could not finish. Please try again.' }) }
}
