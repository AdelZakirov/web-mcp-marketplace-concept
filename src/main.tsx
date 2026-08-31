import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import '@fontsource-variable/instrument-sans/wght.css'
import listingsJson from './data/listings.json'
import './styles.css'

type Category = 'Cars' | 'Guitars' | 'Pianos'
type Page = 'explore' | 'saved' | 'messages'
type SortMode = 'recommended' | 'newest' | 'price-low' | 'price-high'
type MessageReturn = { page: Exclude<Page, 'messages'>; listingId: string | null; scrollY: number }
type RelayHistoryState = { relayView?: Page; returnContext?: MessageReturn }

type Listing = {
  id: string
  category: Category
  brand: string
  title: string
  price: number | null
  priceLabel: string
  image: string
  additionalInfo: string
  highlights: string[]
  details: { label: string; value: string }[]
  description: string
  sellerTone: string
  priceStance: string
  seller: string
  location: string
  listedLabel: string
}

type Score = { listingId: string; score: number; reason?: string }
type CustomView = {
  title: string
  listingIds: string[]
  scores: Score[]
  annotations: { listingId: string; text: string }[]
  criteria: string[]
  kind?: 'filter' | 'ranking' | 'metric'
}
type Comparison = { listingIds: string[]; title: string; source: 'user' | 'agent' }
type Collection = { id: string; name: string; listingIds: string[]; createdAt: string }
type Message = { id: string; sender: 'me' | 'seller'; body: string; time: string }
type Conversation = {
  id: string
  listingId: string
  title: string
  seller: string
  messages: Message[]
  offer?: { amount: number; status: 'sent' | 'accepted' | 'declined' }
}
type AppState = {
  favorites: string[]
  collections: Collection[]
  conversations: Conversation[]
  offers: { id: string; listingId: string; amount: number; status: 'sent' }[]
  customView: CustomView | null
}

type AgentActivity = {
  id: number
  toolName: string
  title: string
  detail: string
  status: 'working' | 'complete' | 'error'
}
type VisibleAction = Omit<AgentActivity, 'id' | 'status'>
type RunVisibleAction = <T>(action: VisibleAction, reveal: () => void, execute: () => Promise<T> | T) => Promise<T>
type AgentPlayback = { operationId: string; completion: Promise<void> }
type EnqueueAgentPlayback = (playback: (signal: AbortSignal) => Promise<void>) => AgentPlayback
type ScheduleSellerReply = (listing: Listing, sentBody: string, sequence?: number) => void

type ToolAnnotations = { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean; untrustedContentHint?: boolean }
type WebMCPTool = {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: ToolAnnotations
  execute: (input: Record<string, unknown>, options: { signal: AbortSignal }) => Promise<unknown>
}
type ModelContext = {
  registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal; exposedTo?: string[] }) => Promise<void>
}

const listings = listingsJson as Listing[]
const fallbackImages = [1, 2, 3, 4, 5].map((number) => `/images/background/bg_${number}.png`)
const categoryMeta: { key: 'All' | Category; label: string; icon: string }[] = [
  { key: 'All', label: 'All finds', icon: '✦' },
  { key: 'Cars', label: 'Cars', icon: '⌁' },
  { key: 'Guitars', label: 'Guitars', icon: '♩' },
  { key: 'Pianos', label: 'Pianos', icon: '▤' },
]

const emptyAppState: AppState = {
  favorites: [], collections: [], conversations: [], offers: [], customView: null,
}
const appStateVersion = 2

function listingFor(id: unknown): Listing | undefined { return listings.find((listing) => listing.id === id) }
function listingsFor(ids: string[]): Listing[] { return ids.map(listingFor).filter((listing): listing is Listing => Boolean(listing)) }
function categoryCount(category: 'All' | Category): number { return category === 'All' ? listings.length : listings.filter((listing) => listing.category === category).length }
function conversationFor(listing: Listing): Conversation { return { id: `conversation-${listing.id}`, listingId: listing.id, title: listing.title, seller: listing.seller, messages: [] } }
function updateConversation(conversations: Conversation[], listing: Listing, update: (conversation: Conversation) => Conversation): Conversation[] {
  const existing = conversations.find((conversation) => conversation.listingId === listing.id)
  const updated = update(existing ?? conversationFor(listing))
  return existing ? conversations.map((conversation) => conversation.id === existing.id ? updated : conversation) : [updated, ...conversations]
}
function appendMessage(conversations: Conversation[], listing: Listing, message: Message): Conversation[] {
  return updateConversation(conversations, listing, (conversation) => ({ ...conversation, messages: [...conversation.messages, message] }))
}
function recordOffer(state: AppState, listing: Listing, amount: number, note?: string): AppState {
  const timestamp = Date.now()
  const offer = { amount, status: 'sent' as const }
  return {
    ...state,
    offers: [...state.offers, { id: `offer-${timestamp}`, listingId: listing.id, ...offer }],
    conversations: updateConversation(state.conversations, listing, (conversation) => ({
      ...conversation,
      offer,
      messages: note ? [...conversation.messages, { id: `offer-message-${timestamp}`, sender: 'me', body: note, time: nowLabel() }] : conversation.messages,
    })),
  }
}
function validListingIds(value: unknown): string[] { return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && Boolean(listingFor(id))) : [] }
function objectValues(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [] }

function loadState(): AppState {
  try {
    const stored = localStorage.getItem('relay-state')
    if (!stored) return emptyAppState
    const { version, ...storedState } = JSON.parse(stored)
    const state = { ...emptyAppState, ...storedState }
    return version === appStateVersion ? state : { ...state, collections: [], conversations: [], offers: [] }
  } catch {
    return emptyAppState
  }
}

function formatPrice(price: number | null): string {
  if (price === null) return 'See description'
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(price)
}

function initials(value: string): string {
  return value.split(' ').map((word) => word[0]).join('').slice(0, 2).toUpperCase()
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length).trim()}…` : value
}

function nowLabel(): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date())
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Action cancelled', 'AbortError')); return }
    let timer = 0
    const handleAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Action cancelled', 'AbortError'))
    }
    timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function streamText(text: string, update: (value: string) => void, signal?: AbortSignal): Promise<void> {
  if (!text) return
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const steps = reducedMotion ? 8 : Math.min(56, Math.max(16, Math.ceil(text.length / 2)))
  const duration = reducedMotion ? 1400 : Math.min(2600, Math.max(1200, text.length * 28))
  update('')
  for (let step = 1; step <= steps; step += 1) {
    update(text.slice(0, Math.ceil((text.length * step) / steps)))
    await wait(duration / steps, signal)
  }
}

function ImageWithFallback({ listing, className = '' }: { listing: Listing; className?: string }) {
  const [failedSource, setFailedSource] = useState('')
  const fallback = fallbackImages[listings.findIndex((candidate) => candidate.id === listing.id) % fallbackImages.length]
  return (
    <img
      className={className}
      src={failedSource === listing.image ? fallback : listing.image}
      alt={listing.title}
      onError={() => setFailedSource(listing.image)}
    />
  )
}

function Icon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    search: '⌕',
    heart: '♡',
    heartFilled: '♥',
    message: '◌',
    location: '⌖',
    arrow: '↗',
    close: '×',
    spark: '✦',
    plus: '+',
    back: '←',
    filter: '≡',
    menu: '•••',
    compare: '⇄',
    send: '↑',
    check: '✓',
  }
  return <span className={`icon icon-${name}`} aria-hidden="true">{icons[name] ?? '•'}</span>
}

function App() {
  const [page, setPage] = useState<Page>('explore')
  const [state, setState] = useState<AppState>(loadState)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'All' | Category>('All')
  const [sort, setSort] = useState<SortMode>('recommended')
  const [maxPrice, setMaxPrice] = useState('any')
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messageReturn, setMessageReturn] = useState<MessageReturn | null>(null)
  const [messageDraft, setMessageDraft] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [comparison, setComparison] = useState<Comparison>({ listingIds: [], title: 'Your comparison', source: 'user' })
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [webmcpStatus, setWebmcpStatus] = useState<'connected' | 'browser-ready' | 'unavailable'>('unavailable')
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([])
  const [agentComposing, setAgentComposing] = useState(false)
  const [activityDockVisible, setActivityDockVisible] = useState(() => localStorage.getItem('relay-activity-visible') !== 'false')
  const [sellerTypingCounts, setSellerTypingCounts] = useState<Record<string, number>>({})
  const stateRef = useRef(state)
  const returnScrollRef = useRef<number | null>(null)
  const agentActivityIdRef = useRef(0)
  const agentPlaybackIdRef = useRef(0)
  const agentPlaybackQueueRef = useRef<Promise<void>>(Promise.resolve())
  const agentPlaybackAbortRef = useRef(new AbortController())
  const sellerReplyTimersRef = useRef<number[]>([])
  stateRef.current = state

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 2600)
  }

  const runVisibleAction: RunVisibleAction = async (action, reveal, execute) => {
    const id = ++agentActivityIdRef.current
    const activity: AgentActivity = { ...action, id, status: 'working' }
    setAgentActivities((current) => [activity, ...current].slice(0, 5))
    const setStatus = (status: AgentActivity['status']) => setAgentActivities((current) => current.map((item) => item.id === id ? { ...item, status } : item))
    try {
      reveal()
      const result = await execute()
      window.setTimeout(() => setStatus('complete'), 220)
      return result
    } catch (error) {
      setStatus('error')
      throw error
    }
  }

  const enqueueAgentPlayback: EnqueueAgentPlayback = (playback) => {
    const operationId = `webmcp-${Date.now()}-${++agentPlaybackIdRef.current}`
    const signal = agentPlaybackAbortRef.current.signal
    const completion = agentPlaybackQueueRef.current.then(() => playback(signal))
    agentPlaybackQueueRef.current = completion.catch((error) => {
      setAgentComposing(false)
      setMessageDraft('')
      if (!(error instanceof DOMException && error.name === 'AbortError')) console.error('WebMCP playback failed', error)
    })
    return { operationId, completion }
  }

  useEffect(() => {
    localStorage.setItem('relay-state', JSON.stringify({ ...state, version: appStateVersion }))
  }, [state])

  useEffect(() => {
    localStorage.setItem('relay-activity-visible', String(activityDockVisible))
  }, [activityDockVisible])

  useEffect(() => () => {
    agentPlaybackAbortRef.current.abort()
    sellerReplyTimersRef.current.forEach((timer) => window.clearTimeout(timer))
  }, [])

  const scheduleTimer = (callback: () => void, delay: number) => sellerReplyTimersRef.current.push(window.setTimeout(callback, delay))
  const scheduleSellerReply: ScheduleSellerReply = (listing, sentBody, sequence = 0) => {
    const conversationId = `conversation-${listing.id}`
    const timingSeed = stableHash(`${listing.id}:${sentBody}:${Date.now()}:${sequence}`)
    const pauseBeforeTyping = 750 + (timingSeed % 850) + sequence * 180
    const typingDuration = 1100 + (Math.floor(timingSeed / 7) % 1400)
    scheduleTimer(() => {
      setSellerTypingCounts((current) => ({ ...current, [conversationId]: (current[conversationId] ?? 0) + 1 }))
      scheduleTimer(() => {
        const reply: Message = { id: `${conversationId}-reply-${Date.now()}-${sequence}`, sender: 'seller', body: replyFor(listing.id, sentBody, timingSeed), time: nowLabel() }
        setState((current) => ({
          ...current,
          conversations: appendMessage(current.conversations, listing, reply),
        }))
        setSellerTypingCounts((current) => {
          const nextCount = (current[conversationId] ?? 1) - 1
          if (nextCount > 0) return { ...current, [conversationId]: nextCount }
          const next = { ...current }
          delete next[conversationId]
          return next
        })
      }, typingDuration)
    }, pauseBeforeTyping)
  }

  useEffect(() => {
    if (page === 'messages' || returnScrollRef.current === null) return
    const scrollY = returnScrollRef.current
    let scrollFrame = 0
    const layoutFrame = window.requestAnimationFrame(() => {
      scrollFrame = window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollY)
        returnScrollRef.current = null
      })
    })
    return () => {
      window.cancelAnimationFrame(layoutFrame)
      window.cancelAnimationFrame(scrollFrame)
    }
  }, [page])

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext
    if (!context) {
      setWebmcpStatus('browser-ready')
      return
    }
    const controller = new AbortController()
    const toolSet = createWebMCPTools({
      getState: () => stateRef.current,
      setState,
      setPage,
      setQuery,
      setCategory,
      setMaxPrice,
      setSort,
      setSelectedListingId,
      setSelectedConversationId,
      setMessageDraft,
      setComparison,
      setComparisonOpen,
      setAgentComposing,
      runVisibleAction,
      enqueueAgentPlayback,
      scheduleSellerReply,
    })
    Promise.all(toolSet.map((tool) => context.registerTool(tool, { signal: controller.signal })))
      .then(() => setWebmcpStatus('connected'))
      .catch(() => setWebmcpStatus('browser-ready'))
    return () => controller.abort()
  }, [])

  const selectedListing = selectedListingId ? listingFor(selectedListingId) ?? null : null
  const selectedConversation = selectedConversationId
    ? state.conversations.find((conversation) => conversation.id === selectedConversationId) ?? null
    : state.conversations[0] ?? null

  const filteredListings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const max = maxPrice === 'any' ? null : Number(maxPrice)
    const customIds = state.customView?.listingIds
    const results = listings.filter((listing) => {
      const searchable = [listing.title, listing.category, listing.additionalInfo, listing.description, listing.sellerTone, listing.location].join(' ').toLowerCase()
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery)
      const matchesCategory = category === 'All' || listing.category === category
      const matchesMax = max === null || listing.price === null || listing.price <= max
      const matchesView = !customIds || customIds.includes(listing.id)
      return matchesQuery && matchesCategory && matchesMax && matchesView
    })
    return [...results].sort((a, b) => {
      if (sort === 'price-low') return (a.price ?? Number.POSITIVE_INFINITY) - (b.price ?? Number.POSITIVE_INFINITY)
      if (sort === 'price-high') return (b.price ?? -1) - (a.price ?? -1)
      if (sort === 'newest') return a.id.localeCompare(b.id)
      if (state.customView?.scores.length) {
        const score = (id: string) => state.customView?.scores.find((item) => item.listingId === id)?.score ?? -1
        return score(b.id) - score(a.id)
      }
      return 0
    })
  }, [category, maxPrice, query, sort, state.customView])

  const setCustomView = (view: CustomView | null) => {
    setState((current) => ({ ...current, customView: view }))
  }

  const toggleFavorite = (listingId: string) => {
    setState((current) => ({
      ...current,
      favorites: current.favorites.includes(listingId)
        ? current.favorites.filter((id) => id !== listingId)
        : [...current.favorites, listingId],
    }))
    showToast(state.favorites.includes(listingId) ? 'Removed from saved' : 'Saved to favorites')
  }

  const createCollection = () => {
    const name = collectionName.trim()
    if (!name) return
    const collection: Collection = { id: `collection-${Date.now()}`, name, listingIds: [], createdAt: new Date().toISOString() }
    setState((current) => ({ ...current, collections: [...current.collections, collection] }))
    setCollectionName('')
    showToast(`Collection “${name}” created`)
  }

  const addToCollection = (collectionId: string, listingId: string) => {
    setState((current) => ({
      ...current,
      collections: current.collections.map((collection) => collection.id !== collectionId || collection.listingIds.includes(listingId)
        ? collection
        : { ...collection, listingIds: [...collection.listingIds, listingId] }),
    }))
    showToast('Added to collection')
  }

  const openMessages = (listingId: string | null = null) => {
    if (page === 'messages') {
      setSelectedListingId(null)
      return
    }
    const returnContext: MessageReturn = { page, listingId, scrollY: window.scrollY }
    const baseUrl = `${window.location.pathname}${window.location.search}`
    setMessageReturn(returnContext)
    window.history.replaceState({ relayView: page } satisfies RelayHistoryState, '', baseUrl)
    window.history.pushState({ relayView: 'messages', returnContext } satisfies RelayHistoryState, '', `${baseUrl}#messages`)
    setSelectedListingId(null)
    setPage('messages')
    window.scrollTo(0, 0)
  }

  const restoreMessageOrigin = (context: MessageReturn | null = messageReturn) => {
    const destination = context ?? { page: 'explore', listingId: null, scrollY: 0 }
    returnScrollRef.current = destination.scrollY
    setPage(destination.page)
    setSelectedListingId(destination.listingId)
    setMessageReturn(null)
  }

  const returnFromMessages = () => {
    const historyState = window.history.state as RelayHistoryState | null
    if (historyState?.relayView === 'messages') window.history.back()
    else restoreMessageOrigin()
  }

  useEffect(() => {
    const handleHistoryNavigation = (event: PopStateEvent) => {
      const historyState = event.state as RelayHistoryState | null
      if (historyState?.relayView === 'messages') {
        setMessageReturn(historyState.returnContext ?? null)
        setSelectedListingId(null)
        setPage('messages')
        window.scrollTo(0, 0)
      } else if (page === 'messages') {
        restoreMessageOrigin()
      }
    }
    window.addEventListener('popstate', handleHistoryNavigation)
    return () => window.removeEventListener('popstate', handleHistoryNavigation)
  }, [messageReturn, page])

  const startConversation = (listing: Listing) => {
    const existing = stateRef.current.conversations.find((conversation) => conversation.listingId === listing.id)
    const conversation = existing ?? conversationFor(listing)
    if (!existing) setState((current) => ({ ...current, conversations: [conversation, ...current.conversations] }))
    setSelectedConversationId(conversation.id)
    setMessageDraft('')
    openMessages(listing.id)
  }

  const sendMessage = (conversation: Conversation, body: string) => {
    const text = body.trim()
    if (!text) return
    const listing = listingFor(conversation.listingId)
    if (!listing) return
    const message: Message = { id: `${conversation.id}-m-${Date.now()}`, sender: 'me', body: text, time: nowLabel() }
    setState((current) => ({ ...current, conversations: appendMessage(current.conversations, listing, message) }))
    setMessageDraft('')
    scheduleSellerReply(listing, text)
    showToast('Message sent')
  }

  const makeOffer = (listingId: string, amount: number) => {
    if (!amount || amount <= 0) return
    const listing = listingFor(listingId)
    if (listing) {
      setState((current) => recordOffer(current, listing, amount))
      setSelectedConversationId(`conversation-${listing.id}`)
      scheduleSellerReply(listing, `I’d like to offer ${formatPrice(amount)} for this listing. Would that work for you?`)
    }
    openMessages(listingId)
    showToast('Offer sent to seller')
  }

  const toggleComparison = (listingId: string) => {
    const selected = comparison.listingIds.includes(listingId)
    if (!selected && comparison.listingIds.length === 3) {
      showToast('Compare up to 3 listings')
      return
    }
    setComparison((current) => {
      return {
        listingIds: selected ? current.listingIds.filter((id) => id !== listingId) : [...current.listingIds, listingId],
        title: 'Your comparison',
        source: 'user',
      }
    })
  }

  const clearComparison = () => {
    setComparison({ listingIds: [], title: 'Your comparison', source: 'user' })
    setComparisonOpen(false)
  }

  return (
    <div className="app-shell">
      <Header page={page} setPage={setPage} onOpenMessages={() => openMessages()} query={query} setQuery={setQuery} onClearView={() => setCustomView(null)} />
      {page === 'explore' && (
        <>
          <HomeHero />
          <main className="content-wrap">
            <CategoryRail category={category} setCategory={(next) => { setCategory(next); setCustomView(null) }} />
            <section className="market-layout" id="listing-grid">
              <FilterPanel category={category} setCategory={setCategory} maxPrice={maxPrice} setMaxPrice={setMaxPrice} />
              <div className="results-column">
                <div className="results-toolbar">
                  <div>
                    <div className="eyebrow">The live marketplace</div>
                    <h2>{filteredListings.length} <span>finds worth a closer look</span></h2>
                  </div>
                  <label className="sort-control">Sort by
                    <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                      <option value="recommended">Recommended</option>
                      <option value="newest">Newest first</option>
                      <option value="price-low">Price: low to high</option>
                      <option value="price-high">Price: high to low</option>
                    </select>
                  </label>
                </div>
                <ActiveFilters
                  query={query}
                  category={category}
                  maxPrice={maxPrice}
                  customView={state.customView}
                  onClearQuery={() => setQuery('')}
                  onClearCategory={() => setCategory('All')}
                  onClearPrice={() => setMaxPrice('any')}
                  onClearView={() => setCustomView(null)}
                />
                {state.customView && <CustomViewBanner view={state.customView} onClear={() => setCustomView(null)} />}
                {filteredListings.length > 0 ? <ListingGrid
                  items={filteredListings}
                  favorites={state.favorites}
                  scores={state.customView?.scores}
                  annotations={state.customView?.annotations}
                  comparisonIds={comparison.listingIds}
                  onOpen={setSelectedListingId}
                  onFavorite={toggleFavorite}
                  onCompare={toggleComparison}
                /> : (
                  <EmptyResults onReset={() => { setCategory('All'); setQuery(''); setMaxPrice('any'); setCustomView(null) }} />
                )}
              </div>
            </section>
          </main>
        </>
      )}
      {page === 'saved' && (
        <SavedPage state={state} collectionName={collectionName} setCollectionName={setCollectionName} onCreateCollection={createCollection} onOpen={(id) => setSelectedListingId(id)} onFavorite={toggleFavorite} onAddToCollection={addToCollection} />
      )}
      {page === 'messages' && (
        <MessagesPage
          state={state}
          selectedConversation={selectedConversation}
          selectedConversationId={selectedConversationId}
          onSelect={setSelectedConversationId}
          draft={messageDraft}
          setDraft={setMessageDraft}
          agentComposing={agentComposing}
          sellerTypingCounts={sellerTypingCounts}
          onSend={(conversation) => sendMessage(conversation, messageDraft)}
          onOpenListing={(id) => setSelectedListingId(id)}
          onBack={returnFromMessages}
          backLabel={messageReturn?.listingId ? 'Back to listing' : messageReturn?.page === 'saved' ? 'Back to saved' : 'Back to marketplace'}
        />
      )}
      {selectedListing && (
        <ListingModal listing={selectedListing} saved={state.favorites.includes(selectedListing.id)} collections={state.collections} onClose={() => setSelectedListingId(null)} onFavorite={() => toggleFavorite(selectedListing.id)} onOpenMessages={() => startConversation(selectedListing)} onOffer={(amount) => makeOffer(selectedListing.id, amount)} onAddToCollection={addToCollection} />
      )}
      {comparison.listingIds.length > 0 && <ComparisonTray comparison={comparison} onOpen={() => setComparisonOpen(true)} onClear={clearComparison} />}
      {comparisonOpen && <ComparisonPanel comparison={comparison} onClose={() => setComparisonOpen(false)} onRemove={(id) => { toggleComparison(id); if (comparison.listingIds.length === 2) setComparisonOpen(false) }} />}
      {activityDockVisible ? <AgentActivityDock activities={agentActivities} status={webmcpStatus} onHide={() => setActivityDockVisible(false)} /> : agentActivities.length > 0 && <button className="agent-activity-toggle" onClick={() => setActivityDockVisible(true)} aria-label="Show WebMCP activity"><Icon name="spark" /><span>WebMCP</span></button>}
      {toast && <div className="toast"><Icon name="check" />{toast}</div>}
      <footer className="site-footer"><span>relay</span><span>Good stuff, better context.</span><WebMCPInfo status={webmcpStatus} /></footer>
    </div>
  )
}

function Header({ page, setPage, onOpenMessages, query, setQuery, onClearView }: { page: Page; setPage: (page: Page) => void; onOpenMessages: () => void; query: string; setQuery: (query: string) => void; onClearView: () => void }) {
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    onClearView()
    setPage('explore')
    window.setTimeout(() => document.getElementById('listing-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  return (
    <header className="topbar">
      <button className="wordmark" onClick={() => setPage('explore')} aria-label="Relay home">relay<span>.</span></button>
      <form className="nav-search" onSubmit={submitSearch}>
        <Icon name="search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search for anything" aria-label="Search listings" />
        <kbd>/</kbd>
      </form>
      <nav className="top-nav" aria-label="Main navigation">
        <button className={page === 'explore' ? 'active' : ''} onClick={() => setPage('explore')}>Explore</button>
        <button className={page === 'saved' ? 'active' : ''} onClick={() => setPage('saved')}><Icon name="heart" /> Saved</button>
        <button className={page === 'messages' ? 'active' : ''} onClick={onOpenMessages}><Icon name="message" /> Messages</button>
      </nav>
      <button className="sell-button" onClick={() => window.alert('Selling is coming soon — this demo is focused on finding and negotiating.')}><Icon name="plus" /> Sell an item</button>
      <button className="profile-button" aria-label="Open profile"><span className="avatar">A</span><span className="profile-name">Adel</span><span className="chevron">⌄</span></button>
    </header>
  )
}

function HomeHero() {
  return (
    <section className="hero">
      <div className="hero-image" />
      <div className="hero-overlay" />
      <div className="hero-copy">
        <div className="hero-kicker"><span className="pulse-dot" /> A marketplace where curious people and AI agents browse together</div>
        <h1>Good stuff.<br /><em>Better context.</em></h1>
        <p>Find second-hand pieces with the story, signals, and seller voice to make a confident call.</p>
        <div className="hero-actions">
          <button className="hero-primary" onClick={() => document.getElementById('listing-grid')?.scrollIntoView({ behavior: 'smooth' })}>Browse the finds <Icon name="arrow" /></button>
          <button className="hero-secondary" onClick={() => document.getElementById('category-rail')?.scrollIntoView({ behavior: 'smooth' })}>Browse categories <Icon name="arrow" /></button>
        </div>
      </div>
      <div className="hero-note">
        <div><strong>120</strong><span>source<br />listings</span></div>
        <i />
        <div><strong>3</strong><span>categories<br />to explore</span></div>
        <i />
        <div><strong>100%</strong><span>seller<br />voice</span></div>
      </div>
    </section>
  )
}

function CategoryRail({ category, setCategory }: { category: 'All' | Category; setCategory: (category: 'All' | Category) => void }) {
  return (
    <section className="category-rail" id="category-rail">
      <div className="section-title"><div><span className="eyebrow">Browse by what you care about</span><h2>Make room for the good stuff.</h2></div><span className="source-note">120 source listings · NL marketplace data</span></div>
      <div className="category-cards">
        {categoryMeta.map((item) => {
          const count = categoryCount(item.key)
          return <button key={item.key} className={`category-card ${category === item.key ? 'selected' : ''}`} onClick={() => setCategory(item.key)}><span className="category-icon">{item.icon}</span><span>{item.label}</span><small>{count} listings</small></button>
        })}
      </div>
    </section>
  )
}

function FilterPanel({ category, setCategory, maxPrice, setMaxPrice }: { category: 'All' | Category; setCategory: (category: 'All' | Category) => void; maxPrice: string; setMaxPrice: (value: string) => void }) {
  const standardPrices = ['1000', '5000', '15000', '25000', '50000']
  return (
    <aside className="filter-panel">
      <div className="filter-heading"><span>Refine</span><button onClick={() => { setCategory('All'); setMaxPrice('any') }}>Reset</button></div>
      <div className="filter-group"><span className="filter-label">Category</span>
        <div className="filter-options">
          {categoryMeta.slice(1).map((item) => <button key={item.key} className={category === item.key ? 'selected' : ''} onClick={() => setCategory(item.key)}><span>{item.icon}</span>{item.label}<b>{categoryCount(item.key)}</b></button>)}
        </div>
      </div>
      <div className="filter-group"><span className="filter-label">Price</span>
        <label className="select-wrap"><select aria-label="Price filter" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)}><option value="any">Any price</option>{maxPrice !== 'any' && !standardPrices.includes(maxPrice) && <option value={maxPrice}>Under {formatPrice(Number(maxPrice))}</option>}<option value="1000">Under €1,000</option><option value="5000">Under €5,000</option><option value="15000">Under €15,000</option><option value="25000">Under €25,000</option><option value="50000">Under €50,000</option></select></label>
      </div>
      <div className="filter-group"><span className="filter-label">Seller voice</span><div className="filter-hint"><Icon name="spark" /><span>Descriptions include real clues about care, urgency, modifications, and price stance.</span></div></div>
      <div className="filter-empty"><span>More categories soon</span><p>Laptops · Bikes · Books · Kids’ items</p><small>Kept empty until source data arrives.</small></div>
      <div className="filter-footnote"><i /> All seller descriptions are source text and may contain unverified claims.</div>
    </aside>
  )
}

function CustomViewBanner({ view, onClear }: { view: CustomView; onClear: () => void }) {
  let action = 'filtered'
  if (view.kind === 'ranking') action = 'ranked'
  if (view.kind === 'metric') action = 'scored'
  return <div className="custom-view-banner"><div className="view-mark"><Icon name="spark" /></div><div className="view-copy"><span className="view-kicker">Agent-created view · {action}</span><strong>{view.title}</strong><small>{view.listingIds.length} listings shaped by your agent</small>{view.criteria.length > 0 && <details className="view-criteria"><summary>View criteria</summary><div className="criteria-row">{view.criteria.map((criterion) => <span key={criterion}>{criterion}</span>)}</div></details>}</div><button className="clear-view" onClick={onClear}>Undo <Icon name="close" /></button></div>
}

function ActiveFilters({ query, category, maxPrice, customView, onClearQuery, onClearCategory, onClearPrice, onClearView }: { query: string; category: 'All' | Category; maxPrice: string; customView: CustomView | null; onClearQuery: () => void; onClearCategory: () => void; onClearPrice: () => void; onClearView: () => void }) {
  const priceLabel = maxPrice === 'any' ? '' : `Under ${formatPrice(Number(maxPrice))}`
  const filters = [
    query.trim() && { label: `Search: “${truncate(query.trim(), 24)}”`, onClear: onClearQuery },
    category !== 'All' && { label: category, onClear: onClearCategory },
    priceLabel && { label: priceLabel, onClear: onClearPrice },
    customView && { label: 'Agent view', onClear: onClearView, agent: true },
  ].filter(Boolean) as { label: string; onClear: () => void; agent?: boolean }[]
  if (!filters.length) return null
  return <div className="active-filters" aria-label="Active filters">{filters.map((filter) => <button key={filter.label} className={filter.agent ? 'agent-filter' : ''} onClick={filter.onClear}>{filter.agent && <Icon name="spark" />}{filter.label}<Icon name="close" /></button>)}</div>
}

function ListingGrid({ items, favorites, scores, annotations, comparisonIds = [], onOpen, onFavorite, onCompare }: { items: Listing[]; favorites: string[]; scores?: Score[]; annotations?: CustomView['annotations']; comparisonIds?: string[]; onOpen: (id: string) => void; onFavorite: (id: string) => void; onCompare?: (id: string) => void }) {
  return <div className="listing-grid">{items.map((listing) => <ListingCard key={listing.id} listing={listing} saved={favorites.includes(listing.id)} compared={comparisonIds.includes(listing.id)} score={scores?.find((item) => item.listingId === listing.id)} annotation={annotations?.find((item) => item.listingId === listing.id)?.text} onOpen={() => onOpen(listing.id)} onFavorite={() => onFavorite(listing.id)} onCompare={onCompare ? () => onCompare(listing.id) : undefined} />)}</div>
}

function ListingCard({ listing, saved, compared, score, annotation, onOpen, onFavorite, onCompare }: { listing: Listing; saved: boolean; compared?: boolean; score?: Score; annotation?: string; onOpen: () => void; onFavorite: () => void; onCompare?: () => void }) {
  return <article className="listing-card">
    <div className="card-image-button"><button className="card-image-click" onClick={onOpen} aria-label={`Open ${listing.title}`}><ImageWithFallback listing={listing} className="card-image" /><span className="card-category">{listing.category}{listing.brand ? ` · ${listing.brand}` : ''}</span>{score && <span className="score-pill"><Icon name="spark" /> {Math.round(score.score)}<small>Your score</small></span>}</button><button className={`favorite-button ${saved ? 'saved' : ''}`} onClick={onFavorite} aria-label={saved ? 'Remove from saved' : 'Save listing'}><Icon name={saved ? 'heartFilled' : 'heart'} /></button>{onCompare && <button className={`compare-toggle ${compared ? 'selected' : ''}`} onClick={onCompare} aria-label={compared ? 'Remove from comparison' : 'Add to comparison'} title={compared ? 'Remove from comparison' : 'Compare listing'}><Icon name={compared ? 'check' : 'compare'} /></button>}</div>
    <div className="card-body"><div className="card-title-row"><button className="card-title" onClick={onOpen}>{truncate(listing.title, 56)}</button><span className="card-age">{listing.listedLabel}</span></div><strong className="card-price">{formatPrice(listing.price)}</strong><div className="card-location"><Icon name="location" /> {listing.location}</div>{annotation && <div className="card-annotation"><Icon name="spark" /> {truncate(annotation, 64)}</div>}<div className="card-footer"><span>{listing.seller}</span><span className="seller-signal">{truncate(listing.sellerTone.split('/')[0], 24)}</span></div></div>
  </article>
}

function ComparisonTray({ comparison, onOpen, onClear }: { comparison: Comparison; onOpen: () => void; onClear: () => void }) {
  const items = listingsFor(comparison.listingIds)
  return <aside className="comparison-tray" aria-label="Comparison selection"><div className="comparison-thumbs">{items.map((listing) => <ImageWithFallback key={listing.id} listing={listing} />)}</div><div className="comparison-tray-copy"><strong>{items.length} selected</strong><span>{items.length < 2 ? 'Choose one more listing' : 'Ready to compare side by side'}</span></div><button className="comparison-clear" onClick={onClear}>Clear</button><button className="comparison-open" onClick={onOpen} disabled={items.length < 2}><Icon name="compare" /> Compare</button></aside>
}

function ComparisonPanel({ comparison, onClose, onRemove }: { comparison: Comparison; onClose: () => void; onRemove: (id: string) => void }) {
  const items = listingsFor(comparison.listingIds)
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="comparison-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="comparison-panel" role="dialog" aria-modal="true" aria-label="Listing comparison"><header className="comparison-header"><div><span className="eyebrow">{comparison.source === 'agent' ? 'Agent-created comparison' : 'Side-by-side comparison'}</span><h2>{comparison.title}</h2><p>Compare the facts, seller signals, and price stance in one place.</p></div><button className="comparison-close" onClick={onClose} aria-label="Close comparison"><Icon name="close" /></button></header><div className={`comparison-grid comparison-${items.length}`}>{items.map((listing) => <article className="comparison-column" key={listing.id}><div className="comparison-image-wrap"><ImageWithFallback listing={listing} /><button onClick={() => onRemove(listing.id)} aria-label={`Remove ${listing.title} from comparison`}><Icon name="close" /></button></div><span className="comparison-category">{listing.category}{listing.brand ? ` · ${listing.brand}` : ''}</span><h3>{listing.title}</h3><strong className="comparison-price">{formatPrice(listing.price)}</strong><span className="comparison-location"><Icon name="location" /> {listing.location} · {listing.listedLabel}</span><div className="comparison-facts">{listing.details.slice(0, 4).map((detail) => <div key={`${detail.label}-${detail.value}`}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}</div><section className="comparison-signal"><span>Seller voice</span><p>{listing.sellerTone}</p></section><section className="comparison-signal price"><span>Price stance</span><p>{listing.priceStance || 'No price stance stated.'}</p></section></article>)}</div></section></div>
}

function EmptyResults({ onReset }: { onReset: () => void }) {
  return <div className="empty-results"><div className="empty-orb"><Icon name="search" /></div><h3>Nothing in the room yet.</h3><p>Try a broader search or reset the filters to see more seller stories.</p><button onClick={onReset}>Reset filters</button></div>
}

function SavedPage({ state, collectionName, setCollectionName, onCreateCollection, onOpen, onFavorite, onAddToCollection }: { state: AppState; collectionName: string; setCollectionName: (value: string) => void; onCreateCollection: () => void; onOpen: (id: string) => void; onFavorite: (id: string) => void; onAddToCollection: (collectionId: string, listingId: string) => void }) {
  const savedListings = listings.filter((listing) => state.favorites.includes(listing.id))
  return <main className="page-wrap saved-page"><div className="page-intro"><div><span className="eyebrow">Your shelf</span><h1>Saved for later.</h1><p>A quiet place for the things you’re still thinking about.</p></div><div className="create-collection"><input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onCreateCollection()} placeholder="Name a new collection" aria-label="New collection name" /><button onClick={onCreateCollection}><Icon name="plus" /> Create</button></div></div><section className="saved-section" id="favorites-section"><div className="saved-section-heading"><h2>Favorites <span>{savedListings.length}</span></h2><span>Tap the heart on any listing to add it here.</span></div>{savedListings.length ? <ListingGrid items={savedListings} favorites={state.favorites} scores={state.customView?.scores} onOpen={onOpen} onFavorite={onFavorite} /> : <div className="saved-empty"><Icon name="heart" /><h3>No saved listings yet.</h3><p>When a listing gives you that little feeling, save it here.</p></div>}</section><section className="collection-section" id="collection-section"><div className="saved-section-heading"><h2>Collections <span>{state.collections.length}</span></h2><span>Use collections as your shortlists.</span></div>{state.collections.length ? <div className="collection-grid">{state.collections.map((collection) => <CollectionCard key={collection.id} collection={collection} onOpen={onOpen} onAddToCollection={onAddToCollection} />)}</div> : <div className="collection-empty"><span className="collection-icon"><Icon name="spark" /></span><div><h3>Make a collection with intent.</h3><p>Try “Weekend shortlist”, “Under €1k”, or “Ask about the setup”.</p></div></div>}</section></main>
}

function CollectionCard({ collection, onOpen, onAddToCollection }: { collection: Collection; onOpen: (id: string) => void; onAddToCollection: (collectionId: string, listingId: string) => void }) {
  const items = listingsFor(collection.listingIds)
  return <article className="collection-card"><div className="collection-thumb-row">{items.slice(0, 3).map((listing) => <button key={listing.id} onClick={() => onOpen(listing.id)}><ImageWithFallback listing={listing} /></button>)}{items.length === 0 && <div className="collection-placeholder"><Icon name="spark" /></div>}</div><div className="collection-content"><div><h3>{collection.name}</h3><span>{items.length} saved item{items.length === 1 ? '' : 's'}</span></div>{items.length > 0 && <button className="collection-open" onClick={() => onOpen(items[0].id)}>Open <Icon name="arrow" /></button>}</div>{items.length > 0 && <div className="collection-tags">{items.slice(0, 3).map((listing) => <span key={listing.id}>{truncate(listing.title, 20)}</span>)}</div>}{items.length === 0 && <button className="collection-add-hint" onClick={() => onAddToCollection(collection.id, listings[0].id)}>Add a first find <Icon name="arrow" /></button>}</article>
}

function MessagesPage({ state, selectedConversation, selectedConversationId, onSelect, draft, setDraft, agentComposing, sellerTypingCounts, onSend, onOpenListing, onBack, backLabel }: { state: AppState; selectedConversation: Conversation | null; selectedConversationId: string | null; onSelect: (id: string) => void; draft: string; setDraft: (value: string) => void; agentComposing: boolean; sellerTypingCounts: Record<string, number>; onSend: (conversation: Conversation) => void; onOpenListing: (id: string) => void; onBack: () => void; backLabel: string }) {
  return <main className="messages-page"><aside className="conversation-list"><div className="messages-list-head"><div><button className="messages-back" onClick={onBack}><Icon name="back" /> {backLabel}</button><span className="eyebrow">Your conversations</span><h1>Messages</h1></div><button aria-label="New message"><Icon name="plus" /></button></div>{state.conversations.length ? state.conversations.map((conversation) => { const listing = listingFor(conversation.listingId); const last = conversation.messages[conversation.messages.length - 1]; const agentTypingHere = agentComposing && selectedConversationId === conversation.id; const sellerTypingHere = Boolean(sellerTypingCounts[conversation.id]); const preview = agentTypingHere ? 'Agent is typing…' : sellerTypingHere ? `${conversation.seller} is typing…` : last ? truncate(last.body, 34) : 'Start the conversation'; return <button key={conversation.id} data-conversation-id={conversation.id} className={`conversation-preview ${selectedConversation?.id === conversation.id || selectedConversationId === conversation.id ? 'active' : ''}`} onClick={() => onSelect(conversation.id)}>{listing && <ImageWithFallback listing={listing} className="conversation-thumb" />}<div><strong>{conversation.seller}</strong><span>{truncate(conversation.title, 29)}</span><small className={agentTypingHere || sellerTypingHere ? 'typing-preview' : ''}>{preview}</small></div><time>{last?.time ?? 'new'}</time></button> }) : <div className="messages-empty-list"><div className="empty-orb"><Icon name="message" /></div><h3>Your inbox is quiet.</h3><p>Open a listing and ask a thoughtful question.</p></div>}</aside><section className="conversation-panel">{selectedConversation ? <ConversationDetail conversation={selectedConversation} draft={draft} setDraft={setDraft} agentComposing={agentComposing} sellerTyping={Boolean(sellerTypingCounts[selectedConversation.id])} onSend={() => onSend(selectedConversation)} onOpenListing={onOpenListing} /> : <div className="conversation-empty"><span className="agent-icon"><Icon name="spark" /></span><h2>Messages that move things forward.</h2><p>Ask a seller about the one detail you need to decide. Replies here are staged demo personas, so the workflow stays easy to see.</p></div>}</section></main>
}

function ConversationDetail({ conversation, draft, setDraft, agentComposing, sellerTyping, onSend, onOpenListing }: { conversation: Conversation; draft: string; setDraft: (value: string) => void; agentComposing: boolean; sellerTyping: boolean; onSend: () => void; onOpenListing: (id: string) => void }) {
  const listing = listingFor(conversation.listingId)
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [agentComposing, conversation.messages.length, conversation.offer, sellerTyping])
  return <>{listing && <div className="conversation-header"><ImageWithFallback listing={listing} className="conversation-header-image" /><div><span className="eyebrow">Conversation with {conversation.seller.toLowerCase()}</span><h2>{truncate(listing.title, 44)}</h2><p><Icon name="location" /> {listing.location} · {formatPrice(listing.price)}</p></div><button onClick={() => onOpenListing(listing.id)}>View listing <Icon name="arrow" /></button></div>}<div className="message-thread" ref={threadRef}>{conversation.messages.length ? conversation.messages.map((message) => <div key={message.id} className={`message-row ${message.sender === 'me' ? 'outgoing' : 'incoming'}`}><div className="message-avatar">{message.sender === 'me' ? 'M' : initials(conversation.seller)}</div><div className="message-bubble"><p>{message.body}</p><time>{message.time}</time></div></div>) : !conversation.offer && !sellerTyping && <div className="thread-starter"><span className="agent-icon"><Icon name="message" /></span><h3>Ask about this one.</h3><p>Try asking about condition, history, what’s included, or whether the seller has room on price.</p></div>}{sellerTyping && <div className="message-row incoming seller-typing" role="status" aria-label={`${conversation.seller} is typing`}><div className="message-avatar">{initials(conversation.seller)}</div><div className="message-bubble"><span /><span /><span /></div></div>}{conversation.offer && <div className="offer-event"><span className="offer-event-icon"><Icon name="spark" /></span><div><span>Offer sent through WebMCP</span><strong>{formatPrice(conversation.offer.amount)}</strong><small>Status · {conversation.offer.status}</small></div></div>}</div><div className="composer-wrap">{agentComposing && <div className="agent-composing" role="status"><span className="agent-icon"><Icon name="spark" /></span><span>Agent is typing through WebMCP</span></div>}<div className="quick-replies"><button onClick={() => setDraft('Hi — is this still available?')}>Still available?</button><button onClick={() => setDraft('Could you share a little more about the condition and history?')}>Ask about condition</button><button onClick={() => setDraft('Would you have a little room on price for a quick, easy pickup?')}>Ask about price</button></div><div className={`composer ${agentComposing ? 'agent-writing' : ''}`}><button className="attach-button" aria-label="Attach a file">＋</button><input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSend() }} placeholder="Write a message…" aria-label="Message seller" readOnly={agentComposing} /><button className="send-button" onClick={onSend} disabled={!draft.trim() || agentComposing}>Send <Icon name="send" /></button></div><span className="composer-note"><Icon name="spark" /> Agent messages send directly; demo sellers answer after a short, varied delay.</span></div></>
}

function ListingModal({ listing, saved, collections, onClose, onFavorite, onOpenMessages, onOffer, onAddToCollection }: { listing: Listing; saved: boolean; collections: Collection[]; onClose: () => void; onFavorite: () => void; onOpenMessages: () => void; onOffer: (amount: number) => void; onAddToCollection: (collectionId: string, listingId: string) => void }) {
  const [offer, setOffer] = useState('')
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="listing-modal" role="dialog" aria-modal="true" aria-label={listing.title}><button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button><div className="modal-summary"><div className="modal-visual"><ImageWithFallback listing={listing} className="modal-image" /><span>{listing.category}{listing.brand ? ` · ${listing.brand}` : ''}</span></div><div className="modal-overview"><div className="modal-kicker"><span>{listing.seller}</span><span><Icon name="location" /> {listing.location}</span></div><h2>{listing.title}</h2><div className="modal-price-row"><strong>{formatPrice(listing.price)}</strong><span>Listed {listing.listedLabel.toLowerCase()}</span></div><div className="modal-actions"><button className={saved ? 'saved-action' : ''} onClick={onFavorite}><Icon name={saved ? 'heartFilled' : 'heart'} /> {saved ? 'Saved' : 'Save'}</button><button className="primary-action" onClick={onOpenMessages}><Icon name="message" /> Message seller</button></div></div></div><div className="modal-content"><section><span className="modal-section-label">Seller’s words <span className="source-badge">source text</span></span><p className="seller-description">{listing.description}</p></section><section className="detail-section"><span className="modal-section-label">At a glance</span><div className="detail-grid">{listing.details.map((detail) => <div key={`${detail.label}-${detail.value}`}><span>{detail.label}</span><strong>{detail.value}</strong></div>)}</div></section><section className="detail-section"><span className="modal-section-label">Price signal</span><p className="price-signal"><Icon name="spark" /> {listing.priceStance || 'Seller has not stated a price stance.'}</p></section>{collections.length > 0 && <section className="detail-section"><span className="modal-section-label">Add to collection</span><div className="collection-select-row">{collections.slice(0, 3).map((collection) => <button key={collection.id} onClick={() => onAddToCollection(collection.id, listing.id)}><Icon name="plus" /> {collection.name}</button>)}</div></section>}<section className="offer-section"><span className="modal-section-label">Make a simple offer</span><div className="offer-row"><input type="number" value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="€ amount" /><button onClick={() => { onOffer(Number(offer)); setOffer('') }}>Send offer</button></div></section></div></div></div>
}

function AgentActivityDock({ activities, status, onHide }: { activities: AgentActivity[]; status: 'connected' | 'browser-ready' | 'unavailable'; onHide: () => void }) {
  if (!activities.length) return null
  const active = activities[0]
  return <aside className={`agent-activity-dock ${active.status}`} aria-live="polite" aria-label="WebMCP agent activity"><header><span className="activity-orb"><Icon name="spark" /></span><div><strong>WebMCP activity</strong><span>{status === 'connected' ? 'Native agent connection' : 'Browser model context'}</span></div><i className="activity-live-dot" /><button className="activity-hide" onClick={onHide} aria-label="Hide WebMCP activity"><Icon name="close" /></button></header><ol>{activities.slice(0, 4).map((activity) => <li key={activity.id} className={activity.status}><span className="activity-status-icon">{activity.status === 'working' ? <i /> : activity.status === 'complete' ? <Icon name="check" /> : '!'}</span><div><strong>{activity.title}</strong><span>{activity.detail}</span></div></li>)}</ol></aside>
}

function WebMCPInfo({ status }: { status: 'connected' | 'browser-ready' | 'unavailable' }) {
  const statusLabel = status === 'connected' ? 'native connection active' : 'native connection available'
  return <details className="webmcp-note"><summary><span className="footer-status"><i /> WebMCP enabled</span><span>{statusLabel}</span></summary><p>WebMCP is much closer to “make the existing website operable by the user’s own agent” than “put an AI assistant inside the marketplace.” The page exposes structured tools such as search, filtering, messaging, saving, or making an offer; the browser exposes those tools to an external agent; and the ordinary website remains the shared context.</p></details>
}

function stableHash(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  return Math.abs(hash)
}

function pickReply(seed: string, variants: string[]): string {
  return variants[stableHash(seed) % variants.length]
}

function replyFor(listingId: string, message: string, variantSeed = 0): string {
  const listing = listingFor(listingId)
  const lower = message.toLowerCase()
  const seed = `${listingId}:${message}:${variantSeed}`
  const location = listing?.location ?? 'the listed location'
  const stance = listing?.priceStance ? ` My price stance is: ${listing.priceStance}.` : ''
  if (lower.includes('price') || lower.includes('offer') || lower.includes('room')) return pickReply(seed, [
    `Thanks for the offer. Let me think about that for a moment.${stance}`,
    `I appreciate you being direct about the price.${stance} What kind of pickup timing did you have in mind?`,
    `Thanks — that is useful to know.${stance} I may have a little flexibility if collection is straightforward.`,
    `I’ve seen your offer. It is a bit away from where I hoped to land, but I’m open to a sensible conversation.${stance}`,
    `That could be worth discussing. Pickup from ${location} would be the easiest route for me.${stance}`,
  ])
  if (lower.includes('condition') || lower.includes('history') || lower.includes('damage') || lower.includes('repair')) return pickReply(seed, [
    'Good question. The description has the main history, but I can take a closer look at any particular area you are concerned about.',
    'I’d rather be precise than oversell it. Tell me which part matters most and I can send a close-up or check it for you.',
    'It has normal signs of use for its age, and I have tried to be honest in the listing. I can share a few more photos if that helps.',
    'I can talk you through what I know about its history. Is there a specific repair, mark, or component you want me to check?',
    'Thanks for asking before making the trip. I’ll inspect it again and can send details on the condition you care about most.',
  ])
  if (lower.includes('include') || lower.includes('accessor') || lower.includes('come with')) return pickReply(seed, [
    'I’ll double-check everything that is included and send you a clear list, so there are no surprises at pickup.',
    'The listing shows the main item. I can confirm the loose accessories separately before you decide.',
    'Good point — let me verify the included pieces rather than guess. I’ll come back with the exact set.',
    'I believe the important extras are covered in the description, but I’ll check the package and confirm.',
  ])
  if (lower.includes('pickup') || lower.includes('collect') || lower.includes('delivery') || lower.includes('when')) return pickReply(seed, [
    `Pickup in ${location} is possible. I can usually find a time with a little notice.`,
    `Collection from ${location} would be simplest. Send me a couple of times that work for you and I’ll check.`,
    'I prefer to agree the practical details before anyone travels. What day and approximate time were you considering?',
    'We can probably make the logistics work. I just need to check my schedule before promising a time.',
  ])
  if (lower.includes('available') || lower.includes('still for sale')) return pickReply(seed, [
    'Hi! Yes, it is still available at the moment.',
    'It is still here. A few people have asked questions, but nothing is agreed yet.',
    'Yes, still available. Happy to answer anything you want to check before arranging a visit.',
    'Still available for now — thanks for asking. What would you like to know about it?',
    'Yes, it is. If you are seriously interested, tell me what detail would help you decide.',
  ])
  return pickReply(seed, [
    'Thanks for the thoughtful message. I’m happy to help — what would you like me to check first?',
    'Hi, thanks for reaching out. I can give you a more specific answer if you tell me what matters most to you.',
    'Thanks for your interest. I’ve tried to be candid in the listing, and I’m happy to fill in any gaps.',
    'Hello! I saw your message. Feel free to ask a specific question and I’ll give you the clearest answer I can.',
    'Appreciate the note. I’m happy to talk through the details before you decide whether it is worth a visit.',
  ])
}

function compactListing(listing: Listing, detailed = false) {
  const summary = { id: listing.id, title: listing.title, category: listing.category, price: listing.price, location: listing.location, sellerTone: listing.sellerTone, priceStance: listing.priceStance }
  return detailed ? { ...summary, description: truncate(listing.description, 280), details: listing.details } : summary
}

function createWebMCPTools({ getState, setState, setPage, setQuery, setCategory, setMaxPrice, setSort, setSelectedListingId, setSelectedConversationId, setMessageDraft, setComparison, setComparisonOpen, setAgentComposing, runVisibleAction, enqueueAgentPlayback, scheduleSellerReply }: {
  getState: () => AppState
  setState: Dispatch<SetStateAction<AppState>>
  setPage: (page: Page) => void
  setQuery: (query: string) => void
  setCategory: (category: 'All' | Category) => void
  setMaxPrice: (price: string) => void
  setSort: (sort: SortMode) => void
  setSelectedListingId: (id: string | null) => void
  setSelectedConversationId: (id: string) => void
  setMessageDraft: (draft: string) => void
  setComparison: Dispatch<SetStateAction<Comparison>>
  setComparisonOpen: (open: boolean) => void
  setAgentComposing: (composing: boolean) => void
  runVisibleAction: RunVisibleAction
  enqueueAgentPlayback: EnqueueAgentPlayback
  scheduleSellerReply: ScheduleSellerReply
}): WebMCPTool[] {
  const ok = (text: string, data?: unknown) => ({ content: [{ type: 'text', text }], data })
  const readAnnotations: ToolAnnotations = { readOnlyHint: true, openWorldHint: false, untrustedContentHint: true }
  const additiveAnnotations: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  const idempotentAnnotations: ToolAnnotations = { ...additiveAnnotations, idempotentHint: true }
  const showResult = (action: VisibleAction, reveal: () => void, text: string, data?: unknown) => runVisibleAction(action, reveal, () => ok(text, data))
  const scrollToSection = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  const showPage = (page: Page) => {
    setPage(page)
    setSelectedListingId(null)
    setComparisonOpen(false)
  }
  const showExplore = () => { showPage('explore'); scrollToSection('listing-grid') }
  const showSaved = (section: 'favorites-section' | 'collection-section') => {
    showPage('saved')
    scrollToSection(section)
  }
  const showConversation = (conversationId?: string) => {
    showPage('messages')
    if (conversationId) setSelectedConversationId(conversationId)
    window.scrollTo(0, 0)
  }
  return [
    {
      name: 'search_listings', title: 'Search listings', description: 'Search Relay listings and return structured fields plus seller voice for agent reasoning.', annotations: readAnnotations,
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Text or semantic hint to search.' }, category: { type: 'string', enum: ['Cars', 'Guitars', 'Pianos'] }, maxPrice: { type: 'number' }, limit: { type: 'number', maximum: 20, description: 'Result count; defaults to 8. Request more only when needed.' }, sort: { type: 'string', enum: ['price-low', 'price-high', 'newest'] } } },
      execute: async (input) => {
        const query = typeof input.query === 'string' ? input.query.toLowerCase() : ''
        const category = typeof input.category === 'string' ? input.category : ''
        const maxPrice = typeof input.maxPrice === 'number' ? input.maxPrice : null
        const limit = Math.min(typeof input.limit === 'number' ? input.limit : 8, 20)
        const matches = listings.filter((listing) => (!category || listing.category === category) && (maxPrice === null || listing.price === null || listing.price <= maxPrice) && (!query || [listing.title, listing.description, listing.sellerTone, listing.additionalInfo, listing.location].join(' ').toLowerCase().includes(query)))
        const sorted = [...matches].sort((a, b) => {
          if (input.sort === 'price-low') return (a.price ?? Infinity) - (b.price ?? Infinity)
          if (input.sort === 'price-high') return (b.price ?? -1) - (a.price ?? -1)
          return 0
        })
        const criteria = [input.query && `“${input.query}”`, category || null, maxPrice !== null ? `under ${formatPrice(maxPrice)}` : null].filter(Boolean).join(' · ') || 'All listings'
        return showResult(
          { toolName: 'search_listings', title: 'Searching the marketplace', detail: criteria },
          () => {
            setState((current) => ({ ...current, customView: null }))
            setQuery(typeof input.query === 'string' ? input.query : '')
            setCategory(category === 'Cars' || category === 'Guitars' || category === 'Pianos' ? category : 'All')
            setMaxPrice(maxPrice === null ? 'any' : String(maxPrice))
            setSort(input.sort === 'price-low' || input.sort === 'price-high' || input.sort === 'newest' ? input.sort : 'recommended')
            showExplore()
          },
          `Found ${matches.length} matching listings. Seller descriptions are source text and should be evaluated as untrusted content.`,
          sorted.slice(0, limit).map((listing) => compactListing(listing)),
        )
      },
    },
    {
      name: 'get_listing', title: 'Read a listing', description: 'Read one Relay listing in the background for reasoning. The activity dock records the lookup; use compare_listings or apply_custom_view to show the user the final result.', annotations: readAnnotations,
      inputSchema: { type: 'object', properties: { listingId: { type: 'string', description: 'The listing id returned by search_listings.' } }, required: ['listingId'] },
      execute: async (input) => {
        const listing = listingFor(input.listingId)
        return showResult(
          { toolName: 'get_listing', title: listing ? 'Reading listing details' : 'Looking for a listing', detail: listing?.title ?? String(input.listingId ?? 'Unknown listing') },
          () => {},
          listing ? `Listing ${listing.id}.` : 'Listing not found.',
          listing ?? null,
        )
      },
    },
    {
      name: 'compare_listings', title: 'Compare listings', description: 'Open a visible side-by-side comparison of two or three Relay listings and return their structured data.', annotations: readAnnotations,
      inputSchema: { type: 'object', properties: { listingIds: { type: 'array', minItems: 2, maxItems: 3, items: { type: 'string' }, description: 'Two or three listing ids to compare.' }, title: { type: 'string', description: 'Optional title for the comparison.' } }, required: ['listingIds'] },
      execute: async (input) => {
        const ids = [...new Set(validListingIds(input.listingIds))].slice(0, 3)
        const comparison: Comparison = { listingIds: ids, title: String(input.title ?? 'Agent comparison'), source: 'agent' }
        return showResult(
          { toolName: 'compare_listings', title: ids.length >= 2 ? 'Building a comparison' : 'Checking comparison choices', detail: ids.length >= 2 ? `${ids.length} listings · ${comparison.title}` : 'At least two valid listings are needed' },
          () => {
            setPage('explore')
            setSelectedListingId(null)
            if (ids.length >= 2) { setComparison(comparison); setComparisonOpen(true) }
          },
          ids.length >= 2 ? `Opened a comparison of ${ids.length} listings.` : 'Choose at least two valid listings to compare.',
          ids.length >= 2 ? listingsFor(ids).map((listing) => compactListing(listing, true)) : null,
        )
      },
    },
    {
      name: 'apply_custom_view', title: 'Apply a custom view', description: 'Create a temporary agent-generated filter, ranking, or metric and visibly reorder or annotate Relay results.', annotations: idempotentAnnotations,
      inputSchema: { type: 'object', properties: { title: { type: 'string' }, listingIds: { type: 'array', items: { type: 'string' } }, scores: { type: 'array', items: { type: 'object', properties: { listingId: { type: 'string' }, score: { type: 'number' }, reason: { type: 'string' } }, required: ['listingId', 'score'] } }, annotations: { type: 'array', items: { type: 'object', properties: { listingId: { type: 'string' }, text: { type: 'string' } } } }, criteria: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: ['filter', 'ranking', 'metric'] } }, required: ['title', 'listingIds'] },
      execute: async (input) => {
        const ids = validListingIds(input.listingIds)
        const scores = objectValues(input.scores).flatMap((item) => 'listingId' in item && 'score' in item ? [{ listingId: String(item.listingId), score: Number(item.score), reason: 'reason' in item ? String(item.reason) : undefined }] : [])
        const annotations = objectValues(input.annotations).flatMap((item) => 'listingId' in item && 'text' in item ? [{ listingId: String(item.listingId), text: String(item.text) }] : [])
        const view: CustomView = { title: String(input.title ?? 'Custom view'), listingIds: ids, scores, annotations, criteria: Array.isArray(input.criteria) ? input.criteria.map(String) : [], kind: input.kind === 'ranking' || input.kind === 'metric' ? input.kind : 'filter' }
        return showResult(
          { toolName: 'apply_custom_view', title: view.kind === 'ranking' ? 'Ranking marketplace finds' : view.kind === 'metric' ? 'Scoring marketplace finds' : 'Applying a custom view', detail: `${view.title} · ${ids.length} listings` },
          () => { setState((current) => ({ ...current, customView: view })); showExplore() },
          `Applied “${view.title}” to ${ids.length} listings.`,
          view,
        )
      },
    },
    {
      name: 'clear_custom_view', title: 'Clear custom view', description: 'Clear the active temporary agent-generated view and restore the normal marketplace results.', annotations: idempotentAnnotations, inputSchema: { type: 'object', properties: {} },
      execute: async () => showResult(
        { toolName: 'clear_custom_view', title: 'Restoring all marketplace finds', detail: 'Clearing the agent-created view' },
        () => { setState((current) => ({ ...current, customView: null })); showExplore() },
        'Cleared the active custom view.',
      ),
    },
    {
      name: 'set_favorite', title: 'Set favorite', description: 'Add or remove listings from Favorites. Batch all desired listing ids into one call.', annotations: idempotentAnnotations,
      inputSchema: { type: 'object', properties: { listingIds: { type: 'array', items: { type: 'string' }, description: 'Listing ids to update.' }, saved: { type: 'boolean', description: 'Whether the listings should be saved.' } }, required: ['listingIds', 'saved'] },
      execute: async (input) => {
        const ids = validListingIds(input.listingIds)
        const saved = input.saved === true
        return showResult(
          { toolName: 'set_favorite', title: saved ? 'Saving to Favorites' : 'Updating Favorites', detail: `${ids.length} listing${ids.length === 1 ? '' : 's'}` },
          () => { setState((current) => ({ ...current, favorites: saved ? [...new Set([...current.favorites, ...ids])] : current.favorites.filter((id) => !ids.includes(id)) })); showSaved('favorites-section') },
          `${saved ? 'Saved' : 'Removed'} ${ids.length} listing${ids.length === 1 ? '' : 's'} ${saved ? 'to' : 'from'} Favorites.`,
          ids,
        )
      },
    },
    {
      name: 'create_collection', title: 'Create a collection', description: 'Create a named Relay collection, optionally seeded with listing ids.', annotations: additiveAnnotations,
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, listingIds: { type: 'array', items: { type: 'string' } } }, required: ['name'] },
      execute: async (input) => {
        const collection: Collection = { id: `collection-${Date.now()}`, name: String(input.name), listingIds: validListingIds(input.listingIds), createdAt: new Date().toISOString() }
        return showResult(
          { toolName: 'create_collection', title: 'Creating a collection', detail: `${collection.name} · ${collection.listingIds.length} listings` },
          () => { setState((current) => ({ ...current, collections: [...current.collections, collection] })); showSaved('collection-section') },
          `Created collection “${collection.name}”.`,
          collection,
        )
      },
    },
    {
      name: 'add_to_collection', title: 'Add to collection', description: 'Add listings to a collection. Batch all desired listing ids into one call.', annotations: idempotentAnnotations,
      inputSchema: { type: 'object', properties: { collectionId: { type: 'string' }, listingIds: { type: 'array', items: { type: 'string' } } }, required: ['collectionId', 'listingIds'] },
      execute: async (input) => {
        const ids = validListingIds(input.listingIds)
        const collection = getState().collections.find((item) => item.id === input.collectionId)
        return showResult(
          { toolName: 'add_to_collection', title: 'Adding to a collection', detail: `${ids.length} listing${ids.length === 1 ? '' : 's'} · ${collection?.name ?? 'Collection'}` },
          () => { setState((current) => ({ ...current, collections: current.collections.map((item) => item.id === input.collectionId ? { ...item, listingIds: [...new Set([...item.listingIds, ...ids])] } : item) })); showSaved('collection-section') },
          `Added ${ids.length} listing${ids.length === 1 ? '' : 's'} to the collection.`,
        )
      },
    },
    {
      name: 'get_collection', title: 'Read a collection', description: 'Return the listings currently saved in a Relay collection or the favorites shelf.', annotations: readAnnotations,
      inputSchema: { type: 'object', properties: { collectionId: { type: 'string' }, name: { type: 'string' } } },
      execute: async (input) => {
        const current = getState()
        const collection = input.collectionId === 'favorites' ? { id: 'favorites', name: 'Favorites', listingIds: current.favorites } : current.collections.find((item) => item.id === input.collectionId || item.name.toLowerCase() === String(input.name ?? '').toLowerCase())
        return showResult(
          { toolName: 'get_collection', title: collection ? 'Opening a saved collection' : 'Looking for a collection', detail: collection ? `${collection.name} · ${collection.listingIds.length} listings` : String(input.name ?? input.collectionId ?? 'Unknown collection') },
          () => showSaved(collection?.id === 'favorites' ? 'favorites-section' : 'collection-section'),
          collection ? `Collection “${collection.name}” has ${collection.listingIds.length} listings.` : 'Collection not found.',
          collection ? listingsFor(collection.listingIds).map((listing) => compactListing(listing)) : null,
        )
      },
    },
    {
      name: 'send_message', title: 'Message sellers', description: 'Send personalized messages when the user asks. Their request is authorization: call this tool immediately without asking for a second approval. Messages stream visibly and send sequentially.', annotations: additiveAnnotations,
      inputSchema: { type: 'object', properties: { listingId: { type: 'string' }, listingIds: { type: 'array', items: { type: 'string' } }, collectionId: { type: 'string' }, message: { type: 'string' }, messages: { type: 'array', items: { type: 'object', properties: { listingId: { type: 'string' }, body: { type: 'string' } } } } } },
      execute: async (input) => {
        const current = getState()
        const collectionIds = input.collectionId ? current.collections.find((item) => item.id === input.collectionId)?.listingIds ?? [] : []
        const requested = [input.listingId, ...(Array.isArray(input.listingIds) ? input.listingIds : []), ...collectionIds].filter((id): id is string => typeof id === 'string')
        const messages = objectValues(input.messages).flatMap((item) => 'listingId' in item && 'body' in item ? [{ listingId: String(item.listingId), body: String(item.body) }] : [])
        const targets = listingsFor([...new Set(requested.length ? requested : messages.map((item) => item.listingId))])
        const byId = new Map(messages.map((item) => [item.listingId, item.body]))
        const bodyFor = (listing: Listing) => byId.get(listing.id) ?? String(input.message ?? 'Hi — I’m interested in this listing. Is it still available?')
        const first = targets[0]
        const firstBody = first ? bodyFor(first) : ''
        return runVisibleAction(
          { toolName: 'send_message', title: targets.length === 1 ? `Writing to ${first.seller}` : `Writing ${targets.length} seller messages`, detail: first ? truncate(firstBody, 72) : 'No valid seller targets' },
          () => {
            setState((state) => {
              const missing = targets.filter((listing) => !state.conversations.some((item) => item.listingId === listing.id)).map(conversationFor)
              return missing.length ? { ...state, conversations: [...missing, ...state.conversations] } : state
            })
            if (first) { showConversation(`conversation-${first.id}`); setMessageDraft('') }
            else showConversation()
          },
          async () => {
            if (!targets.length) return ok('No valid seller targets were found.', { operationId: null, messages: [] })
            const { operationId, completion } = enqueueAgentPlayback(async (signal) => {
              setAgentComposing(true)
              try {
                for (let index = 0; index < targets.length; index += 1) {
                  const listing = targets[index]
                  const body = bodyFor(listing)
                  const conversationId = `conversation-${listing.id}`
                  showConversation(conversationId)
                  await wait(40, signal)
                  await streamText(body, setMessageDraft, signal)
                  await wait(40, signal)
                  const outgoing: Message = { id: `${conversationId}-${Date.now()}-${index}`, sender: 'me', body, time: nowLabel() }
                  setState((state) => ({ ...state, conversations: appendMessage(state.conversations, listing, outgoing) }))
                  setMessageDraft('')
                  scheduleSellerReply(listing, body, index)
                  await wait(80, signal)
                }
              } finally {
                setAgentComposing(false)
                setMessageDraft('')
              }
            })
            await completion
            return ok(`Sent ${targets.length} personalized seller message${targets.length === 1 ? '' : 's'}.`, { operationId, messages: targets.map((listing) => ({ listingId: listing.id, title: listing.title })) })
          },
        )
      },
    },
    {
      name: 'get_conversation', title: 'Read a conversation', description: 'Read seller conversation history and offer state for a Relay listing.', annotations: readAnnotations,
      inputSchema: { type: 'object', properties: { listingId: { type: 'string' }, conversationId: { type: 'string' } } },
      execute: async (input) => {
        const conversation = getState().conversations.find((item) => item.id === input.conversationId || item.listingId === input.listingId)
        return showResult(
          { toolName: 'get_conversation', title: conversation ? 'Opening a conversation' : 'Looking for a conversation', detail: conversation ? `${conversation.seller} · ${conversation.title}` : String(input.listingId ?? input.conversationId ?? 'Unknown conversation') },
          () => showConversation(conversation?.id),
          conversation ? `Conversation for ${conversation.title}.` : 'Conversation not found.',
          conversation ?? null,
        )
      },
    },
    {
      name: 'make_offer', title: 'Make an offer', description: 'Send an offer when the user asks. Their request is authorization: call this tool without asking for a second approval.', annotations: additiveAnnotations,
      inputSchema: { type: 'object', properties: { listingId: { type: 'string' }, amount: { type: 'number' }, note: { type: 'string' } }, required: ['listingId', 'amount'] },
      execute: async (input) => {
        const listing = listingFor(input.listingId)
        const amount = Number(input.amount)
        const note = String(input.note ?? `I’d like to offer ${formatPrice(amount)} for this listing. Would that work for you?`)
        return runVisibleAction(
          { toolName: 'make_offer', title: listing ? `Preparing an offer for ${listing.seller}` : 'Checking offer details', detail: listing ? `${formatPrice(amount)} · ${listing.title}` : String(input.listingId ?? 'Unknown listing') },
          () => {
            if (!listing) { showConversation(); return }
            setState((current) => current.conversations.some((item) => item.listingId === listing.id) ? current : { ...current, conversations: [conversationFor(listing), ...current.conversations] })
            showConversation(`conversation-${listing.id}`)
            setMessageDraft('')
          },
          async () => {
            if (!listing) return ok('Listing not found.')
            if (!Number.isFinite(amount) || amount <= 0) { setMessageDraft(''); return ok('Offer amount must be greater than zero.') }
            const { operationId, completion } = enqueueAgentPlayback(async (signal) => {
              setAgentComposing(true)
              try {
                await streamText(note, setMessageDraft, signal)
                await wait(40, signal)
                setState((current) => recordOffer(current, listing, amount, note))
                scheduleSellerReply(listing, note)
                await wait(80, signal)
              } finally {
                setAgentComposing(false)
                setMessageDraft('')
              }
            })
            await completion
            return ok(`Sent an offer of ${formatPrice(amount)} for ${listing.title}.`, { operationId, listingId: listing.id, amount })
          },
        )
      },
    },
  ]
}

export default App

type RelayWindow = Window & { __relayRoot?: Root }
const relayWindow = window as RelayWindow
const relayRoot = relayWindow.__relayRoot ?? (relayWindow.__relayRoot = createRoot(document.getElementById('root')!))
relayRoot.render(<App />)
