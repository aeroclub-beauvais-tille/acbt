// Carte des fronts (DWD) pour l'écran TEMSI de la TV, voir functions/_cartes.js
import { imageFronts } from '../../_cartes.js';

export const onRequestGet = ({ request, waitUntil }) => imageFronts(request, waitUntil);
