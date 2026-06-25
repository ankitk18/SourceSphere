/**
 * Simple, dependency-free Principal Component Analysis (PCA) implementation
 * that reduces n-dimensional vectors down to 3 dimensions for 3D plotting.
 *
 * Steps:
 *   1. Center the data (subtract the mean of each dimension).
 *   2. Compute the covariance matrix.
 *   3. Extract eigenvectors / eigenvalues of the covariance matrix via the
 *      Jacobi eigenvalue algorithm.
 *   4. Project data onto the top-3 eigenvectors.
 *   5. Scale the projected coordinates to a range that is comfortable for
 *      3d-force-graph (default sphere nodes are unit-sized).
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface ReductionResult {
  points: Point3D[];
  /** Eigenvalues for the top 3 principal components (variance captured). */
  eigenvalues: number[];
  /** Explained variance ratio for the top 3 components. */
  explainedVariance: number[];
}

/**
 * Reduce an array of high-dimensional vectors to 3D coordinates.
 *
 * @param vectors - Array of equal-length numeric vectors (e.g. 384-dim embeddings).
 * @returns {ReductionResult} 3D points + variance information.
 */
export function pcaReduceTo3D(vectors: number[][]): ReductionResult {
  if (!vectors || vectors.length === 0) {
    return { points: [], eigenvalues: [0, 0, 0], explainedVariance: [0, 0, 0] };
  }

  const dims = vectors[0].length;
  if (!vectors.every((v) => v.length === dims)) {
    throw new Error('All input vectors must have the same dimensionality.');
  }

  // 1. Center the data.
  const centered = centerMatrix(vectors);

  // 2. Covariance matrix.
  const cov = covarianceMatrix(centered);

  // 3. Eigen-decomposition.
  const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(cov);

  // 4. Sort eigenvectors by descending eigenvalue.
  const indexed = eigenvalues.map((value, i) => ({ value, vector: eigenvectors[i] }));
  indexed.sort((a, b) => b.value - a.value);

  const topEigenvalues = indexed.slice(0, 3).map((item) => item.value);
  const topEigenvectors = indexed.slice(0, 3).map((item) => item.vector);

  // 5. Project each centered vector onto the top 3 eigenvectors.
  const projected = centered.map((vec) => {
    const coords = topEigenvectors.map((eigVec) => dot(vec, eigVec));
    return { x: coords[0] ?? 0, y: coords[1] ?? 0, z: coords[2] ?? 0 };
  });

  // 6. Scale to a 3D world range that is easy to frame with the camera.
  const points = scaleToWorldSpace(projected, 600);

  // 7. Explained variance ratios.
  const totalVariance = eigenvalues.reduce((sum, v) => sum + v, 0);
  const explainedVariance =
    totalVariance > 0
      ? topEigenvalues.map((v) => v / totalVariance)
      : [0, 0, 0];

  return { points, eigenvalues: topEigenvalues, explainedVariance };
}

// ------------------------------------------------------------------
// Matrix helpers
// ------------------------------------------------------------------

function centerMatrix(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const means: number[] = new Array(cols).fill(0);

  for (let c = 0; c < cols; c++) {
    let sum = 0;
    for (let r = 0; r < rows; r++) {
      sum += matrix[r][c];
    }
    means[c] = sum / rows;
  }

  return matrix.map((row) => row.map((val, c) => val - means[c]));
}

function covarianceMatrix(centered: number[][]): number[][] {
  const rows = centered.length;
  const cols = centered[0].length;
  const cov: number[][] = Array.from({ length: cols }, () => new Array(cols).fill(0));

  for (let i = 0; i < cols; i++) {
    for (let j = i; j < cols; j++) {
      let sum = 0;
      for (let r = 0; r < rows; r++) {
        sum += centered[r][i] * centered[r][j];
      }
      const value = sum / (rows - 1);
      cov[i][j] = value;
      cov[j][i] = value;
    }
  }

  return cov;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Scale projected points to a world-space range that is easy to render.
 *
 * The previous [-1, 1] normalization produced coordinates that were
 * too close to the origin for 3d-force-graph's default camera and
 * lighting. This scales the points so the whole cluster spans ~1200 units
 * (radius 600), keeping nodes well separated while still frameable.
 */
function scaleToWorldSpace(points: Point3D[], targetRadius: number): Point3D[] {
  if (points.length === 0) return [];

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const zs = points.map((p) => p.z);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  const scale = (targetRadius * 2) / maxRange;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;

  return points.map((p) => ({
    x: (p.x - centerX) * scale,
    y: (p.y - centerY) * scale,
    z: (p.z - centerZ) * scale,
  }));
}

// ------------------------------------------------------------------
// Jacobi eigenvalue algorithm for symmetric matrices.
// ------------------------------------------------------------------

interface EigenDecomposition {
  eigenvalues: number[];
  eigenvectors: number[][];
}

function jacobiEigenDecomposition(matrix: number[][]): EigenDecomposition {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]); // mutable copy
  const v = identityMatrix(n);

  const maxIterations = 100;
  const tolerance = 1e-10;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Find largest off-diagonal element.
    let maxVal = 0;
    let p = 0;
    let q = 1;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = Math.abs(a[i][j]);
        if (val > maxVal) {
          maxVal = val;
          p = i;
          q = j;
        }
      }
    }

    if (maxVal < tolerance) break;

    // Compute rotation.
    const app = a[p][p];
    const aqq = a[q][q];
    const apq = a[p][q];
    const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    // Rotate matrix A.
    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = a[i][p];
        const aiq = a[i][q];
        a[i][p] = c * aip - s * aiq;
        a[p][i] = a[i][p];
        a[i][q] = s * aip + c * aiq;
        a[q][i] = a[i][q];
      }
    }

    a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
    a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p][q] = 0;
    a[q][p] = 0;

    // Update eigenvector matrix V.
    for (let i = 0; i < n; i++) {
      const vip = v[i][p];
      const viq = v[i][q];
      v[i][p] = c * vip - s * viq;
      v[i][q] = s * vip + c * viq;
    }
  }

  const eigenvalues = a.map((row, i) => row[i]);
  // `v` columns are the eigenvectors.
  const eigenvectors: number[][] = [];
  for (let i = 0; i < n; i++) {
    eigenvectors.push(v.map((row) => row[i]));
  }

  return { eigenvalues, eigenvectors };
}

function identityMatrix(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
}
