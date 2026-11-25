// Carte des fronts (DWD) pour l'onglet Météo de l'appli membres, voir functions/_cartes.js
import { imageFronts } from '../../_cartes.js';

export const onRequestGet = ({ request, waitUntil }) => imageFronts(request, waitUntil);
