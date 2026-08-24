import { useEffect, useMemo, useRef, useState } from "react";
import type { Model } from "../types/data";

interface ModelMultiSelectProps {
  models: Model[];
  selectedIds: string[];
  onChange: (modelIds: string[]) => void;
  defaultCount?: number;
  maxSelected?: number;
}

export function ModelMultiSelect({
  models,
  selectedIds,
  onChange,
  defaultCount = 30,
  maxSelected = 30,
}: ModelMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [draftIds, setDraftIds] = useState<string[]>(selectedIds);
  const rootRef = useRef<HTMLDivElement>(null);
  const modelOrder = useMemo(() => new Map(models.map((model, index) => [model.id, index])), [models]);
  const filteredModels = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return models;
    return models.filter((model) => `${model.name} ${model.provider}`.toLocaleLowerCase().includes(needle));
  }, [models, search]);
  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function toggleOpen() {
    if (!open) {
      const availableIds = new Set(models.map((model) => model.id));
      setDraftIds(selectedIds.filter((id) => availableIds.has(id)).slice(0, maxSelected));
      setSearch("");
    }
    setOpen((current) => !current);
  }

  function toggleModel(modelId: string) {
    setDraftIds((current) => {
      if (current.includes(modelId)) return current.filter((id) => id !== modelId);
      if (current.length >= maxSelected) return current;
      return [...current, modelId];
    });
  }

  function applySelection() {
    if (draftIds.length < 2) return;
    const ordered = [...draftIds].sort((left, right) => (modelOrder.get(left) ?? 0) - (modelOrder.get(right) ?? 0));
    onChange(ordered);
    setOpen(false);
  }

  function useDefault() {
    setDraftIds([]);
    onChange([]);
    setOpen(false);
  }

  return (
    <div className="model-picker" ref={rootRef}>
      <span className="model-picker-label">HEATMAP MODELS</span>
      <button
        type="button"
        className={`model-picker-trigger ${selectedIds.length ? "is-custom" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Heatmap models, ${selectedIds.length ? `${selectedIds.length} selected` : `default ${defaultCount}`}`}
        onClick={toggleOpen}
      >
        <strong>{selectedIds.length ? `${selectedIds.length} selected` : `Default ${defaultCount}`}</strong><i aria-hidden="true" />
      </button>

      {open && (
        <div className="model-picker-panel" role="dialog" aria-label="Choose heatmap models">
          <header>
            <div><strong>Choose heatmap models</strong><span>Select 2–{maxSelected} models</span></div>
            <b>{draftIds.length}/{maxSelected}</b>
          </header>
          <input
            type="search"
            value={search}
            aria-label="Search heatmap models"
            placeholder="Search model or provider"
            autoFocus
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="model-picker-list">
            {filteredModels.map((model) => {
              const checked = draftSet.has(model.id);
              return (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && draftIds.length >= maxSelected}
                    aria-label={`Include ${model.name}`}
                    onChange={() => toggleModel(model.id)}
                  />
                  <span><strong>{model.name}</strong><small>{model.provider}</small></span>
                </label>
              );
            })}
            {!filteredModels.length && <p>No models match this search.</p>}
          </div>
          <footer>
            <button type="button" className="model-picker-reset" onClick={useDefault}>Use default {defaultCount}</button>
            <button type="button" className="model-picker-apply" disabled={draftIds.length < 2} onClick={applySelection}>Show {draftIds.length || "selected"} models</button>
          </footer>
          {draftIds.length === 1 && <p className="model-picker-hint">Choose one more model to form a pair.</p>}
        </div>
      )}
    </div>
  );
}
