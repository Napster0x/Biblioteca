import { create } from 'zustand';
import type { AnotacionesService } from '@/services/annotations/AnotacionesService';
import type { Annotacion, AnnotacionInput } from '@/types/annotaciones';

export interface AnotacionesState {
  annotations: Annotacion[];
  isLoading: boolean;
  isSelectMode: boolean;
  selectedAnnotationIds: string[];
  searchQuery: string;
  error: string | null;
}

export interface AnotacionesActions {
  loadAnnotations(service: AnotacionesService): Promise<void>;
  searchAnnotations(query: string, service: AnotacionesService): Promise<void>;
  createAnnotation(input: AnnotacionInput, service: AnotacionesService): Promise<Annotacion>;
  updateAnnotation(id: string, note: string, service: AnotacionesService): Promise<Annotacion>;
  deleteAnnotations(ids: readonly string[], service: AnotacionesService): Promise<void>;
  removeAnnotationsFromState(ids: readonly string[]): void;
  setSearchQuery(query: string): void;
  toggleSelect(id: string): void;
  selectAll(): void;
  enterSelectMode(): void;
  exitSelectMode(): void;
  reset(): void;
}

export type AnotacionesStore = AnotacionesState & AnotacionesActions;

export const useAnotacionesStore = create<AnotacionesStore>((set) => ({
  annotations: [],
  isLoading: false,
  isSelectMode: false,
  selectedAnnotationIds: [],
  searchQuery: '',
  error: null,

  async loadAnnotations(service) {
    set({ isLoading: true });
    try {
      const annotations = await service.listAnnotations();
      set({ annotations, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async searchAnnotations(query, service) {
    set({ isLoading: true });
    try {
      const annotations = await service.searchAnnotations(query);
      set({ annotations, searchQuery: query, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  async createAnnotation(input, service) {
    set({ isLoading: true });
    try {
      const annotation = await service.createAnnotation(input);
      set((state) => ({
        annotations: [annotation, ...state.annotations],
        isLoading: false,
      }));
      return annotation;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  async updateAnnotation(id, note, service) {
    set({ isLoading: true });
    try {
      const annotation = await service.updateAnnotation({ id, note });
      set((state) => ({
        annotations: state.annotations.map((item) => (item.id === id ? annotation : item)),
        isLoading: false,
      }));
      return annotation;
    } catch (err) {
      set({ isLoading: false });
      throw err;
    }
  },

  async deleteAnnotations(ids, service) {
    if (ids.length === 0) return;

    set({ isLoading: true });
    try {
      await service.deleteAnnotations(ids);
      useAnotacionesStore.getState().removeAnnotationsFromState(ids);
      set({ isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  removeAnnotationsFromState(ids) {
    if (ids.length === 0) return;
    const deletedIds = new Set(ids);
    set((state) => ({
      annotations: state.annotations.filter((a) => !deletedIds.has(a.id)),
      selectedAnnotationIds: state.selectedAnnotationIds.filter((id) => !deletedIds.has(id)),
    }));
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  toggleSelect(id) {
    set((state) => ({
      selectedAnnotationIds: state.selectedAnnotationIds.includes(id)
        ? state.selectedAnnotationIds.filter((selectedId) => selectedId !== id)
        : [...state.selectedAnnotationIds, id],
    }));
  },

  selectAll() {
    set((state) => ({
      selectedAnnotationIds: state.annotations.map((a) => a.id),
    }));
  },

  enterSelectMode() {
    set({ isSelectMode: true });
  },

  exitSelectMode() {
    set({ isSelectMode: false, selectedAnnotationIds: [] });
  },

  reset() {
    set({
      annotations: [],
      isLoading: false,
      isSelectMode: false,
      selectedAnnotationIds: [],
      searchQuery: '',
      error: null,
    });
  },
}));
