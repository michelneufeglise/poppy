/// <reference types="vite/client" />
import type { PoppyApi } from '../preload/index'

declare global {
  interface Window {
    poppy: PoppyApi
  }
}

export {}
