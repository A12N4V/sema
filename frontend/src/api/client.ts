// Typed fetch wrappers over the EEGvis backend. One function per endpoint —
// no generic "call(path, body)" helper, so a route rename is a compile
// error at every call site instead of a silent runtime 404.

const BASE = "http://localhost:8123";

export interface SessionInfo {
  session_id: string;
  filename: string;
  channel_names: string[];
  channel_types: string[];
  channel_type_counts: Record<string, number>;
  n_channels: number;
  sfreq: number;
  n_times: number;
  duration_seconds: number;
  bads: string[];
  highpass: number | null;
  lowpass: number | null;
  has_montage: boolean;
  annotations: { onset: number; duration: number; description: string }[];
  meas_date: string | null;
}

export interface TraceWindow {
  channels: string[];
  sfreq: number;
  time: number[];
  traces: Record<string, number[]>;
}

export interface ICAComponent {
  index: number;
  excluded: boolean;
  variance_explained: number | null;
}

export interface PSDResult {
  freqs: number[];
  channels: string[];
  psd_db: number[][];
}

export interface BandPowerResult {
  channels: string[];
  bands: Record<string, number[]>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body — keep statusText */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  uploadFile(file: File): Promise<SessionInfo> {
    const form = new FormData();
    form.append("file", file);
    return req<SessionInfo>("/api/sessions/upload", { method: "POST", body: form });
  },

  getSession(sessionId: string): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}`);
  },

  deleteSession(sessionId: string): Promise<void> {
    return req(`/api/sessions/${sessionId}`, { method: "DELETE" });
  },

  getTraceWindow(
    sessionId: string,
    params: { start: number; duration: number; channels?: string[]; max_points?: number },
  ): Promise<TraceWindow> {
    return req<TraceWindow>(`/api/sessions/${sessionId}/viewer/window`, {
      method: "POST",
      body: JSON.stringify(params),
    });
  },

  applyBandpass(sessionId: string, l_freq: number | null, h_freq: number | null): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/bandpass`, {
      method: "POST",
      body: JSON.stringify({ l_freq, h_freq }),
    });
  },

  applyNotch(sessionId: string, freqs: number[]): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/notch`, {
      method: "POST",
      body: JSON.stringify({ freqs }),
    });
  },

  applyResample(sessionId: string, sfreq: number): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/resample`, {
      method: "POST",
      body: JSON.stringify({ sfreq }),
    });
  },

  setBadChannels(sessionId: string, bads: string[]): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/bad-channels`, {
      method: "POST",
      body: JSON.stringify({ bads }),
    });
  },

  setReference(sessionId: string, ref_channels: string | string[] = "average"): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/reference`, {
      method: "POST",
      body: JSON.stringify({ ref_channels }),
    });
  },

  setMontage(sessionId: string, montage_name = "standard_1020"): Promise<SessionInfo> {
    return req<SessionInfo>(`/api/sessions/${sessionId}/preprocessing/montage`, {
      method: "POST",
      body: JSON.stringify({ montage_name }),
    });
  },

  fitIca(sessionId: string, n_components: number, method = "fastica"): Promise<{ n_components: number; components: ICAComponent[] }> {
    return req(`/api/sessions/${sessionId}/ica/fit`, {
      method: "POST",
      body: JSON.stringify({ n_components, method }),
    });
  },

  getIcaComponents(sessionId: string): Promise<{ components: ICAComponent[] }> {
    return req(`/api/sessions/${sessionId}/ica/components`);
  },

  getIcaTopomap(sessionId: string, index: number): Promise<{ index: number; png_base64: string }> {
    return req(`/api/sessions/${sessionId}/ica/components/${index}/topomap`);
  },

  setIcaExclusions(sessionId: string, exclude: number[]): Promise<{ components: ICAComponent[] }> {
    return req(`/api/sessions/${sessionId}/ica/exclude`, {
      method: "POST",
      body: JSON.stringify({ exclude }),
    });
  },

  applyIca(sessionId: string): Promise<{ applied: boolean; excluded: number[] }> {
    return req(`/api/sessions/${sessionId}/ica/apply`, { method: "POST" });
  },

  getPsd(sessionId: string, fmin = 1, fmax = 45, channels?: string[]): Promise<PSDResult> {
    return req<PSDResult>(`/api/sessions/${sessionId}/spectral/psd`, {
      method: "POST",
      body: JSON.stringify({ fmin, fmax, channels }),
    });
  },

  getBandPower(sessionId: string): Promise<BandPowerResult> {
    return req<BandPowerResult>(`/api/sessions/${sessionId}/spectral/band-power`);
  },

  getBandTopomap(sessionId: string, band: string, channels?: string[]): Promise<{ band: string; png_base64: string }> {
    return req(`/api/sessions/${sessionId}/spectral/band-topomap`, {
      method: "POST",
      body: JSON.stringify({ band, channels }),
    });
  },

  epochsFromAnnotations(sessionId: string, tmin: number, tmax: number): Promise<Record<string, unknown>> {
    return req(`/api/sessions/${sessionId}/epochs/from-annotations`, {
      method: "POST",
      body: JSON.stringify({ tmin, tmax }),
    });
  },

  exportRawUrl(sessionId: string): string {
    return `${BASE}/api/sessions/${sessionId}/export/raw.fif`;
  },

  exportEpochsUrl(sessionId: string): string {
    return `${BASE}/api/sessions/${sessionId}/export/epochs.fif`;
  },
};
