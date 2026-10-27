import { v4 as uuidv4 } from 'uuid';
import type {
  Trip,
  CreateTripRequest,
  UpdateTripRequest,
} from '@/types';
import { assertSafeId } from './encryption';
import { deleteRows, getDoc, inTx, listDocs, putDoc } from './sqlite/docs';
import { trip as tripTable } from './sqlite/schema';

// A trip is stored as a single document (day list + rate snapshot
// embedded) — it is single-user, edited from one page, and small.

const tripKey = (userId: string, tripId: string) => ({
  userId: assertSafeId(userId, 'userId'),
  id: assertSafeId(tripId),
});

// ============================================================
// TRIPS CRUD
// ============================================================

export async function getTrips(userId: string): Promise<Trip[]> {
  const trips = listDocs<Trip>(tripTable, { userId: assertSafeId(userId, 'userId') });

  // Newest trip first.
  return trips.sort((a, b) => b.startDateTime.localeCompare(a.startDateTime));
}

export async function getTripById(userId: string, tripId: string): Promise<Trip | null> {
  return getDoc<Trip>(tripTable, tripKey(userId, tripId));
}

export async function createTrip(userId: string, data: CreateTripRequest): Promise<Trip> {
  const id = uuidv4();
  const now = new Date().toISOString();

  const trip: Trip = {
    id,
    userId,
    name: data.name,
    destinationCountry: data.destinationCountry,
    startDateTime: data.startDateTime,
    endDateTime: data.endDateTime,
    days: data.days,
    rates: data.rates,
    linkedAccountId: data.linkedAccountId,
    expectedReimbursementMonth: data.expectedReimbursementMonth,
    status: data.status ?? 'planned',
    notes: data.notes,
    createdAt: now,
    updatedAt: now,
  };

  putDoc(tripTable, tripKey(userId, id), trip);

  return trip;
}

export async function updateTrip(
  userId: string,
  tripId: string,
  updates: UpdateTripRequest
): Promise<Trip | null> {
  return inTx(() => {
    const trip = getDoc<Trip>(tripTable, tripKey(userId, tripId));
    if (!trip) {
      return null;
    }

    const updatedTrip: Trip = {
      ...trip,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    putDoc(tripTable, tripKey(userId, tripId), updatedTrip);
    return updatedTrip;
  });
}

export async function deleteTrip(userId: string, tripId: string): Promise<boolean> {
  deleteRows(tripTable, tripKey(userId, tripId));
  return true;
}
