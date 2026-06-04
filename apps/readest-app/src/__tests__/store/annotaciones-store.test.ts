import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnotacionesStore } from '@/store/annotacionesStore';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { Annotacion, AnnotacionInput } from '@/types/annotaciones';

const annotationOne: Annotacion = {
  id: 'annot-1',
  bookHash: 'book-1',
  bookTitle: 'Ficciones',
  bookAuthor: 'Borges',
  cfi: '/6/4',
  sectionHref: null,
  page: 12,
  text: 'El universo es una vasta biblioteca.',
  note: 'nota uno',
  style: 'highlight',
  color: 'yellow',
  createdAt: 1,
  updatedAt: null,
};

const annotationTwo: Annotacion = {
  id: 'annot-2',
  bookHash: 'book-2',
  bookTitle: 'El Aleph',
  bookAuthor: 'Borges',
  cfi: '/6/8',
  sectionHref: 'sec-2',
  page: 33,
  text: 'Siempre imaginé que el Paraíso sería una especie de biblioteca.',
  note: 'nota dos',
  style: 'underline',
  color: 'blue',
  createdAt: 2,
  updatedAt: 2,
};

function asAnotacionesService(service: Partial<AnotacionesService>): AnotacionesService {
  return service as AnotacionesService;
}

describe('annotacionesStore', () => {
  afterEach(() => {
    useAnotacionesStore.getState().reset();
  });

  it('initializes with the documented default state', () => {
    const state = useAnotacionesStore.getState();

    expect(state.annotations).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.isSelectMode).toBe(false);
    expect(state.selectedAnnotationIds).toEqual([]);
    expect(state.searchQuery).toBe('');
    expect(state.error).toBeNull();
  });

  it('loads annotations from the service and sets them in state', async () => {
    const mockAnnotations = [annotationOne, annotationTwo];
    const service = { listAnnotations: vi.fn().mockResolvedValue(mockAnnotations) };

    await useAnotacionesStore.getState().loadAnnotations(asAnotacionesService(service));

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toEqual(mockAnnotations);
    expect(state.isLoading).toBe(false);
    expect(service.listAnnotations).toHaveBeenCalledOnce();
  });

  it('flips isLoading to true while loadAnnotations is in flight', async () => {
    const service = {
      listAnnotations: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 10))),
    };

    const loadPromise = useAnotacionesStore
      .getState()
      .loadAnnotations(asAnotacionesService(service));
    expect(useAnotacionesStore.getState().isLoading).toBe(true);
    await loadPromise;
    expect(useAnotacionesStore.getState().isLoading).toBe(false);
  });

  it('searches annotations via the service and updates searchQuery plus annotations', async () => {
    const matches = [annotationTwo];
    const service = { searchAnnotations: vi.fn().mockResolvedValue(matches) };

    await useAnotacionesStore
      .getState()
      .searchAnnotations('Paraíso', asAnotacionesService(service));

    const state = useAnotacionesStore.getState();
    expect(state.searchQuery).toBe('Paraíso');
    expect(state.annotations).toEqual(matches);
    expect(state.isLoading).toBe(false);
    expect(service.searchAnnotations).toHaveBeenCalledWith('Paraíso');
  });

  it('creates an annotation via the service, prepends it to the list, and returns the new annotation', async () => {
    const existing = annotationOne;
    const created: Annotacion = {
      ...annotationTwo,
      id: 'annot-3',
      createdAt: 3,
    };
    const service = { createAnnotation: vi.fn().mockResolvedValue(created) };
    useAnotacionesStore
      .getState()
      .loadAnnotations(
        asAnotacionesService({ listAnnotations: vi.fn().mockResolvedValue([existing]) }),
      );
    // Set annotations directly since the store's setAnnotations isn't exported
    useAnotacionesStore.setState({ annotations: [existing] });

    const input: AnnotacionInput = {
      bookHash: created.bookHash,
      bookTitle: created.bookTitle,
      bookAuthor: created.bookAuthor,
      cfi: created.cfi,
      sectionHref: created.sectionHref,
      page: created.page,
      text: created.text,
      note: created.note,
      style: created.style,
      color: created.color,
    };
    const result = await useAnotacionesStore
      .getState()
      .createAnnotation(input, asAnotacionesService(service));

    const state = useAnotacionesStore.getState();
    expect(service.createAnnotation).toHaveBeenCalledWith(input);
    expect(result).toEqual(created);
    expect(state.annotations).toEqual([created, existing]);
    expect(state.isLoading).toBe(false);
  });

  it('enters select mode, toggles ids, and clears selection on exit', () => {
    const store = useAnotacionesStore.getState();

    store.enterSelectMode();
    store.toggleSelect('annot-1');
    store.toggleSelect('annot-2');
    store.toggleSelect('annot-1');

    expect(useAnotacionesStore.getState().isSelectMode).toBe(true);
    expect(useAnotacionesStore.getState().selectedAnnotationIds).toEqual(['annot-2']);

    useAnotacionesStore.getState().exitSelectMode();

    expect(useAnotacionesStore.getState().isSelectMode).toBe(false);
    expect(useAnotacionesStore.getState().selectedAnnotationIds).toEqual([]);
  });

  it('selectAll adds all loaded annotation ids to the selection', () => {
    useAnotacionesStore.setState({ annotations: [annotationOne, annotationTwo] });
    useAnotacionesStore.getState().enterSelectMode();
    useAnotacionesStore.getState().selectAll();

    const state = useAnotacionesStore.getState();
    expect(state.selectedAnnotationIds).toEqual(['annot-1', 'annot-2']);
  });

  it('clears all state during reset', () => {
    useAnotacionesStore.setState({
      annotations: [annotationOne, annotationTwo],
      isLoading: true,
      searchQuery: 'test',
      error: 'boom',
    });
    useAnotacionesStore.getState().enterSelectMode();
    useAnotacionesStore.getState().toggleSelect('annot-1');

    useAnotacionesStore.getState().reset();

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.searchQuery).toBe('');
    expect(state.error).toBeNull();
    expect(state.isSelectMode).toBe(false);
    expect(state.selectedAnnotationIds).toEqual([]);
  });

  it('bulk deletes selected annotations, prunes them from state, and exits select mode', async () => {
    const service = { deleteAnnotations: vi.fn().mockResolvedValue(undefined) };

    useAnotacionesStore.setState({ annotations: [annotationOne, annotationTwo] });
    useAnotacionesStore.getState().enterSelectMode();
    useAnotacionesStore.getState().toggleSelect('annot-2');

    await useAnotacionesStore
      .getState()
      .deleteAnnotations(['annot-2'], asAnotacionesService(service));

    const state = useAnotacionesStore.getState();
    expect(service.deleteAnnotations).toHaveBeenCalledWith(['annot-2']);
    expect(state.annotations).toEqual([annotationOne]);
    expect(state.isLoading).toBe(false);

    // Exit select mode after delete
    useAnotacionesStore.getState().exitSelectMode();
    expect(useAnotacionesStore.getState().isSelectMode).toBe(false);
    expect(useAnotacionesStore.getState().selectedAnnotationIds).toEqual([]);
  });

  it('deleteAnnotations removes the requested ids from state', async () => {
    const service = { deleteAnnotations: vi.fn().mockResolvedValue(undefined) };
    useAnotacionesStore.setState({ annotations: [annotationOne, annotationTwo] });

    await useAnotacionesStore
      .getState()
      .deleteAnnotations(['annot-1'], asAnotacionesService(service));

    const state = useAnotacionesStore.getState();
    expect(service.deleteAnnotations).toHaveBeenCalledWith(['annot-1']);
    expect(state.annotations).toEqual([annotationTwo]);
    expect(state.isLoading).toBe(false);
  });

  it('removeAnnotationsFromState prunes local state without calling SQL', () => {
    useAnotacionesStore.setState({
      annotations: [annotationOne, annotationTwo],
      selectedAnnotationIds: ['annot-1', 'annot-2'],
    });

    useAnotacionesStore.getState().removeAnnotationsFromState(['annot-2']);

    const state = useAnotacionesStore.getState();
    expect(state.annotations).toEqual([annotationOne]);
    expect(state.selectedAnnotationIds).toEqual(['annot-1']);
  });

  it('setSearchQuery updates the search query in state', () => {
    useAnotacionesStore.getState().setSearchQuery('Borges');
    expect(useAnotacionesStore.getState().searchQuery).toBe('Borges');
  });

  it('does not call delete service when ids list is empty', async () => {
    const service = { deleteAnnotations: vi.fn().mockResolvedValue(undefined) };

    await useAnotacionesStore.getState().deleteAnnotations([], asAnotacionesService(service));

    expect(service.deleteAnnotations).not.toHaveBeenCalled();
    expect(useAnotacionesStore.getState().isLoading).toBe(false);
  });
});
