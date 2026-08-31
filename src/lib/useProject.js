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
      // Written against the freshest copy so two quick clicks cannot race.
      const current = await api.projects.get({ id: projectId });
      const spec = { ...current.spec };
      if (value === undefined) delete spec[fieldId];
      else spec[fieldId] = value;
      await api.projects.update({ id: projectId, patch: { spec } });
      await reload();
    },
    [projectId, reload]
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
  const saveMeasurement = useCallback(
    async (garment, fieldId, value) => {
      await api.measurements.save({ projectId, garment, fieldId, value });
      if (project?.client_id) {
        await api.clientMeasurements.save({ clientId: project.client_id, garment, fieldId, value });
      }
      await reload();
    },
    [projectId, project?.client_id, reload]
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
    updateSpec, updateAnalysis, updateProject,
    savePhoto, deletePhoto,
    addNote, deleteNote,
    saveMeasurement,
    reloadReferences,
    photoBySlot,
  };
}
