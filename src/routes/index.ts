import { type Route } from '../types'
import { transcriptionHandler, translationHandler } from './audio'
import { chatHandler } from './chat'
import { completionHandler } from './completion'
import { embeddingsHandler } from './embeddings'
import { getImageHandler, imageGenerationHandler } from './image'
import { modelHandler, modelsHandler } from './models'
import { responsesHandler } from './responses'
import { speechHandler } from './speech'

export type { Route, RouteHandler } from '../types'

function v1Optional(path: string): RegExp {
  return new RegExp(`^(?:/v1)?${path}$`)
}

export const routes: Route[] = [
  { method: 'GET', path: /^\/$/, handler: () => new Response('OK') },
  {
    method: 'GET',
    path: v1Optional('/models'),
    handler: modelsHandler,
    auth: true,
  },
  {
    method: 'GET',
    path: v1Optional('/models/.+'),
    handler: modelHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/chat/completions'),
    handler: chatHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/completions'),
    handler: completionHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/responses'),
    handler: responsesHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/embeddings'),
    handler: embeddingsHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/images/generations'),
    handler: imageGenerationHandler,
    auth: true,
  },
  {
    method: 'GET',
    path: v1Optional('/images/get/[^/]+'),
    handler: getImageHandler,
  },
  {
    method: 'POST',
    path: v1Optional('/audio/transcriptions'),
    handler: transcriptionHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/audio/translations'),
    handler: translationHandler,
    auth: true,
  },
  {
    method: 'POST',
    path: v1Optional('/audio/speech'),
    handler: speechHandler,
    auth: true,
  },
]
