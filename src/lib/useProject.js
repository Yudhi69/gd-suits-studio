import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Loads one order and everything hanging off it, and gives the screens a small
 * set of writers. Every writer persists first and then refreshes, so what is on
 * screen is always what is in the database - there is no unsaved state to lose
 * if the app is closed mid-consultation.
 */
export function useProject(projectId) {
  const [project, setProject] = useState(null);
  // Which suit the garment pages are editing. Null means the order's first,
  // which is the only one on a single-person order.
  const [activeSuitId, setActiveSuitId] = useState(null);
  const [references, setReferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await api.projects.get({ id: projectId });
      if (!data) throw new Error('That order no longer exists.');
      setProject(data);
      setReferences(await api.references.list({ clientId: data.client_id }));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  const updateSpec = useCallback(
    async (fieldId, value) => {
      // Written against the freshest copy so two quick clicks cannot race,
      // and against the suit being edited rather than the order - on a
      // wedding party the groom's lapel is not the best man's.
      const current = await api.projects.get({ id: projectId });
      const suits = current.suits ?? [];
      const target = suits.find((s) => s.id === activeSuitId) ?? suits[0] ?? null;
      const spec = { ...(target ? target.spec : current.spec) };
      if (value === undefined) delete spec[fieldId];
      else spec[fieldId] = value;

      if (target) await api.suits.update({ id: target.id, patch: { spec } });
      else await api.projects.update({ id: projectId, patch: { spec } });
      await reload();
    },
    [projectId, reload, activeSuitId]
  );

  const updateAnalysis = useCallback(
    async (patch) => {
      const current = await api.projects.get({ id: projectId });
      await api.projects.update({ id: projectId, patch: { analysis: { ...current.analysis, ...patch } } });
      await reload();
    },
    [projectId, reload]
  );

  const updateProject = useCallback(
    async (patch) => {
      await api.projects.update({ id: projectId, patch });
      await reload();
    },
    [projectId, reload]
  );

  const savePhoto = useCallback(
    async ({ slot, dataUrl, meta, garment, fittingId }) => {
      await api.photos.add({ projectId, slot, dataUrl, meta, garment, fittingId });
      await reload();
    },
    [projectId, reload]
  );

  const deletePhoto = useCallback(
    async (id) => {
      await api.photos.delete({ id });
      await reload();
    },
    [reload]
  );

  const addNote = useCallback(
    async (step, body) => {
      await api.notes.add({ projectId, step, body });
      await reload();
    },
    [projectId, reload]
  );

  const deleteNote = useCallback(
    async (id) => {
      await api.notes.delete({ id });
      await reload();
    },
    [reload]
  );

  /** Measurements are written to the order and to the client's running body record. */
  const suits = project?.suits ?? [];
  const activeSuit = suits.find((s) => s.id === activeSuitId) ?? suits[0] ?? null;

  const saveMeasurement = useCallback(
    async (garment, fieldId, value) => {
      await api.measurements.save({ projectId, suitId: activeSuit?.id, garment, fieldId, value });
      // The body record follows the person the suit is for, not the person
      // whose name is on the order - on a wedding party they differ.
      const person = activeSuit?.client_id ?? project?.client_id;
      if (person) {
        await api.clientMeasurements.save({ clientId: person, garment, fieldId, value });
      }
      await reload();
    },
    [projectId, activeSuit?.id, activeSuit?.client_id, project?.client_id, reload]
  );

  const reloadReferences = useCallback(async () => {
    if (!project?.client_id) return;
    setReferences(await api.references.list({ clientId: project.client_id }));
  }, [project?.client_id]);

  const photoBySlot = useCallback(
    (slot) => project?.photos?.find((p) => p.slot === slot && !p.fitting_id) ?? null,
    [project]
  );

  return {
    project, references, loading, error, reload,
    suits,
    activeSuit,
    activeSuitId: activeSuit?.id ?? null,
    setActiveSuitId,
    // The spec the garment pages edit: the active suit's, falling back to the
    // order's for a database that predates suits entirely.
    spec: activeSuit?.spec ?? project?.spec ?? {},
    updateSpec, updateAnalysis, updateProject,
    savePhoto, deletePhoto,
    addNote, deleteNote,
    saveMeasurement,
    reloadReferences,
    photoBySlot,
  };
}
