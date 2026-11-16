import React, { useState } from 'react';
import * as mammoth from 'mammoth';
import { Camera, FileSpreadsheet, Upload } from 'lucide-react';
import { procesarExcel } from '../utils/routineImporterHelpers';

interface RoutineUploaderProps {
  onUploadSuccess: (data: any) => void;
  onOpenImageImporter?: () => void;
  onSelectFilesForUnifiedPreview?: (files: File[]) => void;
}

export default function RoutineUploader({
  onUploadSuccess,
  onOpenImageImporter,
  onSelectFilesForUnifiedPreview,
}: RoutineUploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processExcel = async (file: File) => {
    return await procesarExcel(file);
  };

  const processWord = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;
    return sendToVisionExtractor(text, 'text/plain');
  };

  const processVisualDocument = async (file: File) => {
    const base64 = await fileToBase64(file);
    return sendToVisionExtractor(base64, file.type || 'application/pdf');
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (err) => reject(err);
    });
  };

  const sendToVisionExtractor = async (payload: string, mimeType: string) => {
    const promptInstructivo =
      'Extrae esta rutina completa respetando exactamente todos los días presentes, nombres de ejercicios, series, repeticiones, pesos y tiempos de descanso (DESCANSO). Devuelve el resultado estructurado en JSON sin inventar información.';

    const response = await fetch('/api/extraer-rutina-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: payload,
        mimeType,
        prompt: promptInstructivo,
      }),
    });

    if (!response.ok) throw new Error('Error al procesar el archivo en la API');
    return await response.json();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const file = selectedFiles[0];
    if (!file) return;

    const fileType = (file.type || '').toLowerCase();
    const fileName = file.name.toLowerCase();

    if (
      onSelectFilesForUnifiedPreview &&
      (fileType.startsWith('image/') ||
        /\.(png|jpe?g|webp|xlsx|xls|csv|json|pdf)$/i.test(fileName))
    ) {
      event.target.value = '';
      onSelectFilesForUnifiedPreview(selectedFiles);
      return;
    }

    // Si es imagen (PNG, JPG/JPEG, WEBP), redirigir siempre al flujo con vista previa editable y confirmación obligatoria
    if (
      fileType.startsWith('image/') ||
      /\.(png|jpe?g|webp)$/i.test(fileName)
    ) {
      event.target.value = '';
      if (onOpenImageImporter) {
        onOpenImageImporter();
        return;
      }
      setError('Usa el botón "IMPORTAR DESDE IMAGEN" para previsualizar y confirmar capturas.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let extractedData;

      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
        extractedData = await processExcel(file);
      } else if (fileName.endsWith('.docx')) {
        extractedData = await processWord(file);
      } else if (fileName.endsWith('.pdf')) {
        extractedData = await processVisualDocument(file);
      } else {
        throw new Error('Formato de archivo no soportado.');
      }

      onUploadSuccess(extractedData);
    } catch (err: any) {
      setError(err.message || 'Error al procesar la rutina');
    } finally {
      setIsProcessing(false);
      event.target.value = '';
    }
  };

  return (
    <div className="w-full space-y-4">
      {onOpenImageImporter && (
        <button
          type="button"
          onClick={onOpenImageImporter}
          className="w-full min-h-[50px] px-4 py-3 rounded-2xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] cursor-pointer"
        >
          <Camera className="w-4 h-4 stroke-[2.5]" />
          <span>IMPORTAR DESDE IMAGEN (PNG, JPG, WEBP o Cámara)</span>
        </button>
      )}

      <div className="relative border-2 border-dashed border-[#303030] bg-[#171717] rounded-2xl p-6 text-center hover:border-[#CCFF00]/60 transition-colors">
        <input
          type="file"
          accept=".csv, .json, .xlsx, .xls, .docx, .pdf, .png, .jpg, .jpeg, .webp"
          multiple
          onChange={handleFileUpload}
          disabled={isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />

        {isProcessing ? (
          <div className="text-[#CCFF00] text-xs font-bold animate-pulse py-2">
            Procesando documento...
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="w-10 h-10 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center mx-auto text-[#CCFF00]">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <p className="text-[#F5F5F5] text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Subir Excel, Word, PDF o CSV</span>
            </p>
            <p className="text-[#F5F5F5]/55 text-[11px]">
              Lectura automática de planillas y documentos estructurados
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-red-500/15 border border-red-500/40 text-red-200 rounded-xl text-xs">
          {error}
        </div>
      )}
    </div>
  );
}
